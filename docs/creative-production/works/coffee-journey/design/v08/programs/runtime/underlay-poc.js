import './background-assets.css';
import implementation from './journey-runtime.js';
export default {
 mount(c){
  const doc=c.root.ownerDocument,probe=doc.createElement('i');probe.className='coffee-v08-material-resources';probe.hidden=true;c.root.append(probe);
  const style=doc.defaultView.getComputedStyle(probe),assets={};
  for(const name of ['sourcecup','sourcecherry','cherry','section','green','gold','roast','sortingphoto','bagphoto','u03natural','u03washed','u03honey','u05green','u05gold','u05roast']){const v=style.getPropertyValue('--coffee-'+name).trim();assets[name]=v.replace(/^url\(["']?/,'').replace(/["']?\)$/,'')}
  probe.remove();const decorate=i=>({...i,data:{...i.data,assets}});const m=implementation.mount({...c,instance:decorate(c.instance)});return{...m,update(i){m.update(decorate(i))}};
 }
};
