declare module "foliate-js/vendor/zip.js" {
  export function configure(options: { useWebWorkers: boolean }): void;
  export class BlobReader { constructor(blob: Blob); }
  export class BlobWriter { constructor(type?: string); }
  export class ZipReader {
    constructor(reader: BlobReader);
    getEntries(): Promise<Array<{ directory: boolean; filename: string; getData(writer: BlobWriter): Promise<Blob> }>>;
    close(): Promise<void>;
  }
}

declare module "node-unrar-js/esm/index.esm.js" {
  export * from "node-unrar-js/esm";
}
