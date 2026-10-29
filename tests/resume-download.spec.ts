// Скачивание резюме: имена файлов и защита от дублей при смене схемы имени.
// Сеть, браузер и SQLite заменены фейковыми портами — тест проверяет исход и события.
import { describe, expect, it } from "vitest";
import { downloadResumes, type ResumeDownloadDeps, type ResumeDownloadEvent } from "@/application/resume-download";
import type { HhResumeData, HhResumeSummary, Resume } from "@/domain/models";
import type { ResumeFile, ResumeFiles, ResumeSource, SourceProvider } from "@/domain/ports";
import type { RegisteredResume, ResumeRegistration, ResumeRegistry } from "@/domain/digest/ports";

const HASH = "abc123de";
const NAME = `petrov-pavel-petrovich-frontend-razrabotchik-${HASH}`;
const LEGACY_NAME = `petrov-pavel-${HASH}`;

function resumeData(patch: Partial<HhResumeData> = {}): HhResumeData {
  return {
    hash: HASH,
    firstName: "Павел",
    lastName: "Петров",
    middleName: "Петрович",
    title: "Frontend-разработчик",
    salary: null,
    area: "Москва",
    employment: null,
    schedule: null,
    workFormats: [],
    businessTripReadiness: null,
    relocation: null,
    birthDate: null,
    citizenship: [],
    contacts: { phone: null, email: null, telegram: null },
    about: null,
    keySkills: [],
    experience: [],
    education: { primary: [], additional: [] },
    educationLevel: null,
    languages: [],
    certificates: [],
    rawText: null,
    updatedAt: null,
    url: "https://hh.ru/resume/abc",
    ...patch,
  };
}

class FakeSource implements ResumeSource {
  readonly requested: string[] = [];

  constructor(private readonly data: HhResumeData) {}

  async open(): Promise<void> {}

  async listMyResumes(): Promise<HhResumeSummary[]> {
    return [{
      hash: this.data.hash,
      title: this.data.title ?? "",
      status: "published",
      updatedAt: null,
      url: this.data.url,
    }];
  }

  async getMyResume(hash: string): Promise<HhResumeData | null> {
    this.requested.push(hash);
    return hash === this.data.hash ? this.data : null;
  }

  async downloadResumePdf(): Promise<string | null> {
    return null;
  }
}

class FakeFiles implements ResumeFiles {
  readonly md = new Map<string, string>();
  readonly pdf = new Map<string, string>();
  readonly saves: string[] = [];
  readonly renames: Array<[string, string]> = [];

  ensureDir(): string {
    return "resumes";
  }

  list(): ResumeFile[] {
    return [...this.md.keys()].map(name => ({ name, filename: `${name}.md` }));
  }

  load(name?: string): Resume | null {
    const key = name ?? this.list()[0]?.name;
    const text = key === undefined ? undefined : this.md.get(key);
    if (key === undefined || text === undefined) return null;
    return { name: key, id: key, type: "text", text, filename: `${key}.md` };
  }

  pathFor(name: string, kind: 'md' | 'pdf' = 'md'): string {
    return kind === 'pdf' ? `resumes/pdf/${name}.pdf` : `resumes/${name}.md`;
  }

  exists(file: string): boolean {
    const pdfPrefix = "resumes/pdf/";
    if (file.startsWith(pdfPrefix)) return this.pdf.has(file.slice(pdfPrefix.length, -".pdf".length));
    return this.md.has(file.slice("resumes/".length, -".md".length));
  }

  save(name: string, markdown: string, opts: { overwrite?: boolean } = {}): { file: string; saved: boolean } {
    const file = this.pathFor(name, 'md');
    if (this.md.has(name) && !opts.overwrite) return { file, saved: false };
    this.md.set(name, markdown);
    this.saves.push(name);
    return { file, saved: true };
  }

  rename(fromName: string, toName: string): void {
    const text = this.md.get(fromName);
    if (text !== undefined) {
      this.md.delete(fromName);
      this.md.set(toName, text);
    }
    const pdf = this.pdf.get(fromName);
    if (pdf !== undefined) {
      this.pdf.delete(fromName);
      this.pdf.set(toName, pdf);
    }
    this.renames.push([fromName, toName]);
  }
}

class FakeRegistry implements ResumeRegistry {
  readonly registered: string[] = [];

  async register(resume: Resume): Promise<ResumeRegistration> {
    this.registered.push(resume.name);
    return { created: true, changed: false };
  }

  async listRegistered(): Promise<RegisteredResume[]> {
    return [];
  }

  async find(): Promise<RegisteredResume | null> {
    return null;
  }
}

function build(source: ResumeSource, files: FakeFiles, registry: FakeRegistry): ResumeDownloadDeps {
  const provider: SourceProvider<ResumeSource> = { withSource: fn => fn(source) };
  return { source: provider, files, registry, layout: { usesResumesDir: true, hasSingleResume: false } };
}

async function download(files: FakeFiles, registry: FakeRegistry, overwrite = false) {
  const source = new FakeSource(resumeData());
  const events: ResumeDownloadEvent[] = [];
  const results = await downloadResumes(
    { overwrite },
    build(source, files, registry),
    event => events.push(event),
  );
  return { results, events };
}

describe("downloadResumes", () => {
  it("сохраняет новое резюме под именем ФИО и должности и регистрирует его", async () => {
    const files = new FakeFiles();
    const registry = new FakeRegistry();

    const { results, events } = await download(files, registry);

    expect([...files.md.keys()]).toEqual([NAME]);
    expect(registry.registered).toEqual([NAME]);
    expect(results[0]).toMatchObject({ name: NAME, skipped: false, error: null });
    expect(files.md.get(NAME)).toContain("Источник: https://hh.ru/resume/abc");
    expect(events).toContainEqual({ type: "file-saved", title: "Frontend-разработчик", file: `resumes/${NAME}.md` });
  });

  it("не создаёт дубль, если файл лежит под прежним именем, а перезапись не подтверждена", async () => {
    const files = new FakeFiles();
    const registry = new FakeRegistry();
    files.md.set(LEGACY_NAME, "# старое резюме");

    const { results, events } = await download(files, registry);

    expect([...files.md.keys()]).toEqual([LEGACY_NAME]);
    expect(files.saves).toEqual([]);
    expect(registry.registered).toEqual([]);
    expect(results[0]).toMatchObject({ name: LEGACY_NAME, file: `resumes/${LEGACY_NAME}.md`, skipped: true });
    expect(events).toContainEqual({
      type: "file-skipped",
      title: "Frontend-разработчик",
      file: `resumes/${LEGACY_NAME}.md`,
    });
  });

  it("переименовывает старый файл (md и pdf) и перезаписывает содержимое при overwrite", async () => {
    const files = new FakeFiles();
    const registry = new FakeRegistry();
    files.md.set(LEGACY_NAME, "# старое резюме");
    files.pdf.set(LEGACY_NAME, "PDF");

    const { results } = await download(files, registry, true);

    expect(files.renames).toEqual([[LEGACY_NAME, NAME]]);
    expect([...files.md.keys()]).toEqual([NAME]);
    expect([...files.pdf.keys()]).toEqual([NAME]);
    expect(files.md.get(NAME)).toContain("Источник: https://hh.ru/resume/abc");
    expect(registry.registered).toEqual([NAME]);
    expect(results[0]).toMatchObject({ name: NAME, skipped: false, error: null });
  });
});

