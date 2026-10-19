// Команда config: показать текущую конфигурацию.
import { loadConfig } from "../../../infrastructure/config/config.js";

async function configCmd() {
  const cfg = loadConfig();
  console.log(JSON.stringify(cfg, null, 2));
}

export default configCmd;
