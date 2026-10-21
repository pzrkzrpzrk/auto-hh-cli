// Команда resume: управление резюме (list/register/show).
// Данные и проверки — application/resume.ts, здесь только печать и коды возврата.
import {
  listResumesForCli,
  registerResumeByName,
  loadResumeForShow,
  getResumeRegistration,
} from "@/application/resume.js";
import { resumeDeps } from "@/composition.js";

async function cmdResumeList() {
  const outcome = await listResumesForCli(resumeDeps);
  if (outcome.kind === 'empty') {
    console.log("No resumes found. Set RESUMES_DIR or RESUME_PATH.");
    return;
  }

  console.log("\n=== Доступные резюме ===\n");
  for (const row of outcome.rows) {
    console.log(`  ${row.name} (${row.id})${row.registeredAt ? '' : ' (не зарегистрировано)'}`);
    console.log(`    Файл: ${row.filename}`);
    if (row.registeredAt) {
      const updated = row.updatedAt && row.updatedAt !== row.registeredAt ? ` · изменено: ${row.updatedAt}` : '';
      console.log(`    Добавлено: ${row.registeredAt}${updated}`);
    }
    if (row.contentChanged) {
      console.log('    ⚠ файл изменился после регистрации — при следующем digest вердикты и письма этого резюме сбросятся');
    }
    console.log();
  }

  if (!outcome.registryAvailable) {
    console.log('⚠ MongoDB недоступна: статусы регистрации не получены (список файлов показан).\n');
  }
  if (outcome.missingIds.length) {
    console.log(`⚠ В реестре есть резюме без файла: ${outcome.missingIds.join(', ')}\n`);
  }
  if (outcome.orphanIds.length) {
    console.log(`⚠ В кэше есть данные для резюме вне реестра: ${outcome.orphanIds.join(', ')}\n`);
  }
}

async function cmdResumeRegister(name: string) {
  const outcome = await registerResumeByName(name, resumeDeps);
  if (outcome.kind === 'missing-name') {
    console.error('Укажите имя резюме: пункт меню «🧾 Резюме» → register <name>');
    process.exit(1);
  }
  if (outcome.kind === 'not-found') {
    console.error(`Resume "${outcome.name}" not found`);
    process.exit(1);
  }
  const state = outcome.created ? 'зарегистрировано' : (outcome.changed ? 'обновлено (содержимое изменилось)' : 'без изменений');
  console.log(`Резюме «${outcome.name}»: ${state} (id: ${outcome.id})`);
}

async function cmdResumeShow(name?: string) {
  const outcome = loadResumeForShow(name, resumeDeps);
  if (outcome.kind === 'error') {
    console.error(outcome.message);
    process.exit(1);
  }
  if (outcome.kind === 'not-found') {
    console.error('Резюме не найдено. Задайте RESUME_PATH или RESUMES_DIR в .env, либо укажите имя: пункт меню «🧾 Резюме» → show <name>');
    process.exit(1);
  }

  const resume = outcome.resume;
  const registration = await getResumeRegistration(resume, resumeDeps);
  console.log(`\n=== Резюме: ${resume.name} ===`);
  console.log(`  id:      ${resume.id}`);
  console.log(`  файл:    ${resume.filename}`);
  console.log(`  тип:     ${resume.type}`);
  console.log(`  реестр:  ${registration ? `добавлено ${registration.createdAt.toISOString().slice(0, 10)}` : 'не зарегистрировано'}`);
  if (registration?.updatedAt) console.log(`  обновлено: ${registration.updatedAt.toISOString().slice(0, 10)}`);
  if (registration?.contentChanged) console.log('  ⚠ содержимое изменилось после регистрации');
  console.log('');

  if (resume.type === 'pdf') {
    const bytes = resume.data ? Buffer.from(resume.data, 'base64').length : 0;
    console.log(`  PDF-документ (${bytes} байт) — текстовый вывод недоступен. Пересохраните в .md/.txt.`);
    return;
  }
  console.log('--- содержимое ---');
  console.log(resume.text);
}

export default async function cmdResume(opts: Record<string, any> = {}) {
  const sub = opts._?.join(' ') || 'list';
  if (sub.startsWith('register')) {
    const [, name] = sub.split(/\s+/);
    await cmdResumeRegister(name);
  } else if (sub.startsWith('show')) {
    const [, name] = sub.split(/\s+/);
    await cmdResumeShow(name);
  } else {
    await cmdResumeList();
  }
}
