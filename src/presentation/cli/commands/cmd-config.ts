// Команда config: показать текущую конфигурацию.
import { configProvider } from "../../../composition.js";
import { showConfig } from "../../../application/config-view.js";

async function configCmd() {
  const cfg = showConfig({ config: configProvider });
  console.log(JSON.stringify(cfg, null, 2));
}

export default configCmd;
