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
export declare class FileIndexBuilder {
    private logger;
    private workspacePath;
    private ignoredPatterns;
    constructor(workspacePath: string);
    build(): Promise<FileIndex>;
    private scanDirectory;
    private shouldIgnore;
    private processFile;
    private classifyFileType;
    private inferAgentTypes;
    private extractSwiftImports;
    private calculateComplexity;
}
export declare function getOrBuildFileIndex(workspacePath?: string): Promise<FileIndex>;
export declare function saveFileIndex(index: FileIndex, dir?: string): void;
//# sourceMappingURL=file_index_builder.d.ts.map