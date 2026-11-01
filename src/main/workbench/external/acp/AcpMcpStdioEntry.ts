import { runAcpMcpStdioBridge } from './AcpMcpStdioBridge';

// Standalone entry only: Electron runs this file as Node for an ACP-owned MCP child.
// The private capability is inherited only by this child and is never written to account settings.
void runAcpMcpStdioBridge({ endpoint: process.env.GUOLING_ACP_MCP_ENDPOINT ?? '', token: process.env.GUOLING_ACP_MCP_TOKEN ?? '',
  input: process.stdin, output: process.stdout }).catch(() => {
  process.stderr.write('果铃 ACP 领域连接已关闭；未自动重试任何操作。\n');
  process.exitCode = 1;
});
