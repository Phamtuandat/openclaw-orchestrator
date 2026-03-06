import { readdirSync, statSync, readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, extname, relative } from 'path';
import { OpenClawLogger, orchestratorLogger } from './logger';

export type FileType = 'swift' | 'typescript' | 'json' | 'markdown' | 'other';

export interface FileIndexEntry {
  path: string;
  relative: string;
  file_type: FileType;
  agent_types: string[];
  imports?: string[];
  last_modified: string;
  size_bytes: number;
  line_count: number;
  complexity_score?: number;
}

export interface FileIndex {
  version: string;
  generated_at: string;
  workspace_path: string;
  files: Record<string, FileIndexEntry>;
  stats: {
    total_files: number;
    by_type: Record<FileType, number>;
    total_lines: number;
  };
}

export class FileIndexBuilder {
  private logger = orchestratorLogger;
  private workspacePath: string;
  private ignoredPatterns = ['.git', 'node_modules', '.openclaw', 'build', 'DerivedData', '.build'];

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  async build(): Promise<FileIndex> {
    const start = Date.now();
    const index: FileIndex = {
      version: '1.0',
      generated_at: new Date().toISOString(),
      workspace_path: this.workspacePath,
      files: {},
      stats: { total_files: 0, by_type: { swift: 0, typescript: 0, json: 0, markdown: 0, other: 0 }, total_lines: 0 },
    };

    await this.scanDirectory(this.workspacePath, index);
    const duration = Date.now() - start;
    this.logger.info(`File index built: ${index.stats.total_files} files, ${index.stats.total_lines} lines`);
    return index;
  }

  private async scanDirectory(dirPath: string, index: FileIndex): Promise<void> {
    try {
      const entries = readdirSync(dirPath);
      for (const entry of entries) {
        const fullPath = join(dirPath, entry);
        if (this.shouldIgnore(fullPath)) continue;
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          await this.scanDirectory(fullPath, index);
        } else if (stat.isFile()) {
          await this.processFile(fullPath, index);
        }
      }
    } catch (err) {
      this.logger.error(`Scan failed: ${dirPath} - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private shouldIgnore(path: string): boolean {
    const rel = relative(this.workspacePath, path);
    return this.ignoredPatterns.some(p => rel.includes(p));
  }

  private async processFile(filePath: string, index: FileIndex): Promise<void> {
    try {
      const ext = extname(filePath).toLowerCase().substring(1);
      const fileType = this.classifyFileType(ext);
      const relPath = relative(this.workspacePath, filePath);

      const stat = statSync(filePath);
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n').length;

      const agentTypes = this.inferAgentTypes(relPath, fileType);

      let imports: string[] | undefined;
      if (fileType === 'swift') {
        imports = this.extractSwiftImports(content);
      }

      const entry: FileIndexEntry = {
        path: filePath,
        relative: relPath,
        file_type: fileType,
        agent_types: agentTypes,
        imports,
        last_modified: new Date(stat.mtime).toISOString(),
        size_bytes: stat.size,
        line_count: lines,
        complexity_score: this.calculateComplexity(fileType, content, lines),
      };

      index.files[relPath] = entry;
      index.stats.total_files++;
      index.stats.by_type[fileType]++;
      index.stats.total_lines += lines;
    } catch (err) {
      this.logger.error(`Process failed: ${filePath} - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private classifyFileType(ext: string): FileType {
    const map: Record<string, FileType> = { swift: 'swift', ts: 'typescript', tsx: 'typescript', json: 'json', md: 'markdown' };
    return map[ext] || 'other';
  }

  private inferAgentTypes(relPath: string, fileType: FileType): string[] {
    const agents: string[] = [];
    if (fileType === 'swift') {
      if (relPath.includes('ViewModel') || relPath.includes('Store/') || relPath.includes('Repository') || relPath.includes('Service')) {
        agents.push('logic');
      }
      if (relPath.includes('View.swift') || relPath.includes('Views/')) {
        agents.push('ui');
      }
      agents.push('safety');
    }
    return agents;
  }

  private extractSwiftImports(content: string): string[] {
    const lines = content.split('\n');
    const imports: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('import ')) {
        const module = trimmed.replace(/^import\s+/, '').replace(/["';].*$/, '').trim();
        if (module && !imports.includes(module)) imports.push(module);
      }
    }
    return imports;
  }

  private calculateComplexity(fileType: FileType, content: string, lines: number): number {
    if (fileType === 'swift') {
      const funcCount = (content.match(/\bfunc\s+\w+/g) || []).length;
      if (funcCount > 0) return Number((lines / funcCount).toFixed(2));
    }
    return 0;
  }
}

// ============================================
// SINGLETON
// ============================================

let cachedIndex: FileIndex | null = null;

export async function getOrBuildFileIndex(workspacePath?: string): Promise<FileIndex> {
  if (cachedIndex) return cachedIndex;
  const ws = workspacePath || join(process.cwd(), '.openclaw', 'workspace');
  const builder = new FileIndexBuilder(ws);
  cachedIndex = await builder.build();
  return cachedIndex;
}

export function saveFileIndex(index: FileIndex, dir?: string): void {
  const targetDir = dir || join(process.cwd(), '.openclaw', 'index');
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
  const filePath = join(targetDir, 'file_index.json');
  const content = JSON.stringify(index, null, 2);
  appendFileSync(filePath, content, { encoding: 'utf8' });
  orchestratorLogger.info(`Saved file index: ${filePath}`);
}
