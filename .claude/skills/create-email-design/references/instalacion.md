# Instalación de create-email-design

1. Copia la carpeta de la skill (o el paquete `dist/skills/create-email-design/` que genera `npm run build-skills`) en
   `.claude/skills/` del proyecto donde vayas a trabajar. `<PCB>` es su carpeta `cli/` (Node ≥ 24.21, sin `npm install`).
2. **Conocimiento de clientes**: la skill no lleva datos de ningún cliente. Clona el repositorio compartido
   `client-knowledge` y apunta a él con `export CLIENT_KNOWLEDGE_ROOT=/ruta/a/client-knowledge` (o déjalo como
   `./client-knowledge` en la carpeta de trabajo, o pasa `--root` a los comandos `knowledge-*`).
3. MCP de Figma conectado (plugin oficial) con las skills `figma-use` y `figma-generate-design`. Para escribir hace
   falta asiento **Full** en el archivo destino; con asiento View/Dev solo funcionan las lecturas (`get_metadata`,
   `get_screenshot`, `search_design_system`).
4. Comprobación: `node <PCB>/src/cli.ts doctor` y `node <PCB>/src/cli.ts knowledge-list`.
