"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileIndexBuilder = void 0;
exports.getOrBuildFileIndex = getOrBuildFileIndex;
exports.saveFileIndex = saveFileIndex;
const fs_1 = require("fs");
const path_1 = require("path");
const logger_1 = require("./logger");
class FileIndexBuilder {
    logger = logger_1.orchestratorLogger;
    workspacePath;
    ignoredPatterns = ['.git', 'node_modules', '.openclaw', 'build', 'DerivedData', '.build'];
    constructor(workspacePath) {
        this.workspacePath = workspacePath;
    }
    async build() {
        const start = Date.now();
        const index = {
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
    async scanDirectory(dirPath, index) {
        try {
            const entries = (0, fs_1.readdirSync)(dirPath);
            for (const entry of entries) {
                const fullPath = (0, path_1.join)(dirPath, entry);
                if (this.shouldIgnore(fullPath))
                    continue;
                const stat = (0, fs_1.statSync)(fullPath);
                if (stat.isDirectory()) {
                    await this.scanDirectory(fullPath, index);
                }
                else if (stat.isFile()) {
                    await this.processFile(fullPath, index);
                }
            }
        }
        catch (err) {
            this.logger.error(`Scan failed: ${dirPath} - ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    shouldIgnore(path) {
        const rel = (0, path_1.relative)(this.workspacePath, path);
        return this.ignoredPatterns.some(p => rel.includes(p));
    }
    async processFile(filePath, index) {
        try {
            const ext = (0, path_1.extname)(filePath).toLowerCase().substring(1);
            const fileType = this.classifyFileType(ext);
            const relPath = (0, path_1.relative)(this.workspacePath, filePath);
            const stat = (0, fs_1.statSync)(filePath);
            const content = (0, fs_1.readFileSync)(filePath, 'utf8');
            const lines = content.split('\n').length;
            const agentTypes = this.inferAgentTypes(relPath, fileType);
            let imports;
            if (fileType === 'swift') {
                imports = this.extractSwiftImports(content);
            }
            const entry = {
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
        }
        catch (err) {
            this.logger.error(`Process failed: ${filePath} - ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    classifyFileType(ext) {
        const map = { swift: 'swift', ts: 'typescript', tsx: 'typescript', json: 'json', md: 'markdown' };
        return map[ext] || 'other';
    }
    inferAgentTypes(relPath, fileType) {
        const agents = [];
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
    extractSwiftImports(content) {
        const lines = content.split('\n');
        const imports = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('import ')) {
                const module = trimmed.replace(/^import\s+/, '').replace(/["';].*$/, '').trim();
                if (module && !imports.includes(module))
                    imports.push(module);
            }
        }
        return imports;
    }
    calculateComplexity(fileType, content, lines) {
        if (fileType === 'swift') {
            const funcCount = (content.match(/\bfunc\s+\w+/g) || []).length;
            if (funcCount > 0)
                return Number((lines / funcCount).toFixed(2));
        }
        return 0;
    }
}
exports.FileIndexBuilder = FileIndexBuilder;
// ============================================
// SINGLETON
// ============================================
let cachedIndex = null;
async function getOrBuildFileIndex(workspacePath) {
    if (cachedIndex)
        return cachedIndex;
    const ws = workspacePath || (0, path_1.join)(process.cwd(), '.openclaw', 'workspace');
    const builder = new FileIndexBuilder(ws);
    cachedIndex = await builder.build();
    return cachedIndex;
}
function saveFileIndex(index, dir) {
    const targetDir = dir || (0, path_1.join)(process.cwd(), '.openclaw', 'index');
    if (!(0, fs_1.existsSync)(targetDir))
        (0, fs_1.mkdirSync)(targetDir, { recursive: true });
    const filePath = (0, path_1.join)(targetDir, 'file_index.json');
    const content = JSON.stringify(index, null, 2);
    (0, fs_1.appendFileSync)(filePath, content, { encoding: 'utf8' });
    logger_1.orchestratorLogger.info(`Saved file index: ${filePath}`);
}
