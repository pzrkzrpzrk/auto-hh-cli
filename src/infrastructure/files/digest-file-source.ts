// Адаптер порта DigestFileSource: последние .md-файлы дайджеста на диске.
// Fallback для `digest show`, когда MongoDB недоступна: чтение файлов живёт здесь,
// а не в сценарии. Сначала папка резюме, затем legacy data/digests.
import fs from "fs";
import { digestDir, LEGACY_DIGEST_DIR } from "@/infrastructure/config/paths.js";
import { listDigestFiles } from "@/infrastructure/files/digest-files.js";
import type { DigestFileSource } from "@/domain/digest/ports.js";
import type { ResumeRef } from "@/domain/models.js";

function read(files: string[]): string[] {
  return files.map(file => fs.readFileSync(file, 'utf-8'));
}

class FileDigestSource implements DigestFileSource {
  latestContents(resume?: ResumeRef | null): string[] {
    const own = listDigestFiles(digestDir(resume));
    if (own.length) return read(own);
    // Legacy-раскладка: старые дайджесты лежат в data/digests без привязки к резюме.
    return read(listDigestFiles(LEGACY_DIGEST_DIR));
  }
}

export default FileDigestSource;
