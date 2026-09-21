import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import generatedCapabilities from '../../shared/generated/courseAgentCapabilities.json'
import { courseAgentAvailableSkills } from '../../shared/courseAgentSkills'
import { renamePreparedPath } from './preparedRename'

type DirectoryConversationSkills = {
  semanticVersion: string
  root: string
  paths: Record<typeof courseAgentAvailableSkills[number]['name'], string>
}

const skillFiles = Object.entries(generatedCapabilities.files)
  .filter(([relative]) => relative.startsWith('skills/'))
  .sort(([left], [right]) => left.localeCompare(right, 'en'))

if (!/^[a-f0-9]{64}$/.test(generatedCapabilities.semanticVersion)) throw new Error('内置课件方法版本无效')

function resourceRoot(userData: string): string {
  if (!path.isAbsolute(userData)) throw new Error('应用资料目录必须是绝对路径')
  return path.resolve(userData, 'local-agent', 'directory-conversation-skills', generatedCapabilities.semanticVersion)
}

function safeTarget(root: string, relative: string): string {
  const target = path.resolve(root, ...relative.split('/'))
  const relation = path.relative(root, target)
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) throw new Error('内置课件方法路径越界')
  return target
}

async function assertResources(root: string): Promise<void> {
  if (await fs.realpath(root) !== root) throw new Error('内置课件方法目录不能包含链接')
  for (const [relative, content] of skillFiles) {
    const target = safeTarget(root, relative)
    if (await fs.realpath(target) !== target || await fs.readFile(target, 'utf8') !== content) {
      throw new Error(`内置课件方法与当前版本不一致：${relative}`)
    }
  }
}

const preparing = new Map<string, Promise<DirectoryConversationSkills>>()

/** Product-owned directory-chat resources. They are versioned application data,
 * never a user's personal Skill installation or a workspace mutation. */
export async function prepareDirectoryConversationSkills(userData: string): Promise<DirectoryConversationSkills> {
  const root = resourceRoot(userData)
  let work = preparing.get(root)
  if (!work) {
    work = (async () => {
      const parent = path.dirname(root)
      await fs.mkdir(parent, { recursive: true })
      if (await fs.realpath(parent) !== parent) throw new Error('内置课件方法父目录不能包含链接')
      try {
        await fs.stat(root)
        await assertResources(root)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const temporary = path.join(parent, `.${generatedCapabilities.semanticVersion}.${randomUUID()}.tmp`)
        await fs.mkdir(temporary)
        try {
          for (const [relative, content] of skillFiles) {
            const target = safeTarget(temporary, relative)
            await fs.mkdir(path.dirname(target), { recursive: true })
            if (await fs.realpath(path.dirname(target)) !== path.dirname(target)) throw new Error('内置课件方法目录不能包含链接')
            await fs.writeFile(target, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
          }
          await assertResources(temporary)
          await renamePreparedPath(temporary, root, async () => {
            try { await fs.stat(root) }
            catch (reason) {
              if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return true
              throw reason
            }
            await assertResources(root)
            return false
          })
        } finally {
          if (path.dirname(temporary) !== parent) throw new Error('内置课件方法暂存目录越界')
          await fs.rm(temporary, { recursive: true, force: true })
        }
      }
      const paths = Object.fromEntries(courseAgentAvailableSkills.map(skill => {
        const relative = `skills/${skill.name}/SKILL.md`
        if (!skillFiles.some(([file]) => file === relative)) throw new Error(`内置课件方法缺失：${skill.name}`)
        return [skill.name, safeTarget(root, relative)]
      })) as DirectoryConversationSkills['paths']
      return { semanticVersion: generatedCapabilities.semanticVersion, root, paths }
    })()
    preparing.set(root, work)
    void work.finally(() => { if (preparing.get(root) === work) preparing.delete(root) }).catch(() => {})
  }
  return work
}

/** Directory chats keep their native working directory and capabilities. This
 * only publishes exact paths for the product's optional courseware methods. */
export async function directoryConversationSkillPrompt(userData: string, userPrompt: string): Promise<string> {
  const resources = await prepareDirectoryConversationSkills(userData)
  const paths = Object.entries(resources.paths).map(([name, location]) => `- ${name}: ${location}`).join('\n')
  return [
    '应用为本目录会话提供当前版本的内置课件方法；它们是附加资料，不是固定菜单、权限限制或四阶段门。',
    `方法版本：${resources.semanticVersion}。以下绝对路径完整交付当前内置入口、完整方法和任务小卡；当前快照、目标范围和能力合同足够时直接完成任务，不强制读取 courseware-session 或基础方法。普通 Markdown 的局部改字、改写或选区修订无需读取课件方法。只有确实需要课件材料理解、教学设计、构建、修改、检查或导出方法时，才按任务读取必要资料及其相邻引用：`,
    paths,
    '软件内普通任务默认持续推进；只有用户明确要求先审当前真实制品时才等待。不要安装个人课件 Skill、调用外部独立 Builder 命令，或把方法文本当作宿主提交。请求与课件无关时，无需读取这些资料，按原生 CLI 能力正常完成任务。保留原生文件、终端、网络、工具、连接、Skills 和子任务能力。',
    '用户请求：',
    userPrompt,
  ].join('\n')
}
