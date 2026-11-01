import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';

const ns = {
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  c: 'http://schemas.openxmlformats.org/drawingml/2006/chart',
  m: 'http://schemas.openxmlformats.org/officeDocument/2006/math',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
};
const nodes = (element, namespace, name) => Array.from(element.getElementsByTagNameNS(namespace, name));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const cases = [
  ['representative', 'output/component-platform-l23a/representative.pptx'],
  ['mixed-media', 'output/audit-real-machine-20261011/post-fix-consumer/workspace/exports/acceptance-mixed-media.pptx'],
  ['equations', 'output/playwright/r18-equations/edited.pptx'],
  ['charts', 'output/playwright/r17-charts/edited.pptx'],
];
const result = { recordedAt: new Date().toISOString(), boundary: 'Read-only OOXML source facts for the existing representative comparison; no rendering or playback claim.', files: [] };
for (const [id, filename] of cases) {
  const bytes = await fs.readFile(filename), parts = unzipSync(bytes);
  const xml = name => {
    if (!parts[name]) throw Error('Missing part: ' + name);
    return new DOMParser().parseFromString(strFromU8(parts[name]), 'application/xml');
  };
  const relationships = part => {
    const relPart = part ? path.posix.join(path.posix.dirname(part), '_rels', path.posix.basename(part) + '.rels') : '_rels/.rels';
    if (!parts[relPart]) return [];
    return nodes(xml(relPart), ns.rel, 'Relationship').map(node => ({ id: node.getAttribute('Id'), type: node.getAttribute('Type'),
      mode: node.getAttribute('TargetMode') || 'Internal', target: node.getAttribute('Target'),
      resolved: node.getAttribute('TargetMode') === 'External' ? null : path.posix.normalize(node.getAttribute('Target').startsWith('/')
        ? node.getAttribute('Target').slice(1) : path.posix.join(part ? path.posix.dirname(part) : '', node.getAttribute('Target'))),
    }));
  };
  const main = relationships('').find(item => item.type.endsWith('/officeDocument'))?.resolved;
  if (!main) throw Error(id + ' has no presentation relationship');
  const mainRels = relationships(main), presentation = xml(main);
  const slideParts = nodes(presentation, ns.p, 'sldId').map(node => mainRels.find(item => item.id === node.getAttributeNS(ns.r, 'id'))?.resolved);
  const slides = slideParts.map((part, index) => {
    const document = xml(part), tree = nodes(document, ns.p, 'spTree')[0], rels = relationships(part);
    const drawableTags = tree ? Array.from(tree.childNodes).filter(node => node.nodeType === 1
      && !['nvGrpSpPr', 'grpSpPr', 'extLst'].includes(node.localName)).map(node => node.tagName) : [];
    return { index, part, drawableTags, drawingText: nodes(document, ns.a, 't').map(node => node.textContent).join(' '),
      shapes: nodes(document, ns.p, 'sp').length, pictures: nodes(document, ns.p, 'pic').length,
      graphicFrames: nodes(document, ns.p, 'graphicFrame').length, tables: nodes(document, ns.a, 'tbl').length,
      nativeMathObjects: nodes(document, ns.m, 'oMath').length, nativeMathText: nodes(document, ns.m, 't').map(node => node.textContent).join(' '),
      nativeAudioTags: nodes(document, ns.a, 'audioFile').length + nodes(document, ns.a, 'wavAudioFile').length,
      nativeVideoTags: nodes(document, ns.a, 'videoFile').length,
      relationships: rels.filter(item => /\/(?:audio|video|media|image|chart)$/.test(item.type)),
    };
  });
  const charts = Object.keys(parts).filter(name => /^ppt\/charts\/chart[^/]*\.xml$/.test(name)).map(part => {
    const document = xml(part);
    const values = name => nodes(document, ns.c, name).map(node => node.getAttribute('val'));
    return { part, doughnutCharts: nodes(document, ns.c, 'doughnutChart').length,
      holeSize: values('holeSize'), showPercent: values('showPercent'), showCatName: values('showCatName'), showVal: values('showVal'),
      cachedValues: nodes(document, ns.c, 'v').map(node => node.textContent),
    };
  });
  result.files.push({ id, file: path.resolve(filename), sourceSha256: hash(bytes), slides, charts, unchangedAfterRead: hash(await fs.readFile(filename)) === hash(bytes) });
}
const root = path.resolve('output/comprehensive-execution-20261101/office/resume-20261101');
await fs.mkdir(root, { recursive: true });
const out = await fs.mkdtemp(path.join(root, 'source-inspection-'));
result.outputDirectory = out;
await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
