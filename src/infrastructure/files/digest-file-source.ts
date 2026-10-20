// Адаптер порта DigestFileSource: последние .md-файлы дайджеста на диске.
// Fallback для `digest show`, когда MongoDB недоступна: чтение файлов живёт здесь,
// а не в сценарии.
import fs from "fs";
import { DIGEST_DIR } from "@/infrastructure/config/paths.js";
import { listDigestFiles } from "@/infrastructure/files/digest-files.js";
import type { DigestFileSource } from "@/domain/digest/ports.js";

class FileDigestSource implements DigestFileSource {
  latestContents(): string[] {
    return listDigestFiles(DIGEST_DIR).map(file => fs.readFileSync(file, 'utf-8'));
  }
}

export default FileDigestSource;
