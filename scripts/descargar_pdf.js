const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const nit = process.argv[2];
const indice = parseInt(process.argv[3]);
const nombre_archivo = process.argv[4];
const usuario = process.env.SIESA_USUARIO;
const password = process.env.SIESA_PASSWORD;

const ahora = new Date();
const ultimoDia = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate();
const fechaDesde = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-01`;
const fechaHasta = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // ─── LOGIN ───────────────────────────────────────────────────────────────
  await page.goto('https://portalfe.siesacloud.com/smart4b/#/login');
  await page.getByRole('textbox', { name: 'Usuario' }).fill(usuario);
  await page.getByRole('textbox', { name: 'Contraseña' }).fill(password);
  await page.getByRole('button', { name: 'Iniciar Sesión' }).click();
  await page.waitForTimeout(8000);

  // ─── NAVEGACIÓN ──────────────────────────────────────────────────────────
  await page.getByText('Recepción', { exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByText('Recepción De Documentos De').click();
  await page.waitForTimeout(5000);

  // ─── FILTROS ─────────────────────────────────────────────────────────────
  await page.getByRole('textbox', { name: 'Nit Emisor' }).fill(nit);
  await page.getByRole('textbox', { name: 'Nit Emisor' }).press('Tab');
  await page.locator('input#fechaDesde').fill(fechaDesde);
  await page.locator('input#fechaDesde').press('Tab');
  await page.locator('input#fechaHasta').fill(fechaHasta);
  await page.locator('input#fechaHasta').press('Tab');
  await page.getByRole('button', { name: 'Buscar' }).click();
  await page.waitForTimeout(7000);

  // ─── ABRIR DROPDOWN DE LA FILA CORRECTA ──────────────────────────────────
  // Obtener todos los botones toggle de la tabla
  const toggleButtons = page.locator('button.dropdown-toggle');
  const count = await toggleButtons.count();
  console.log(`Filas encontradas: ${count}, usando índice: ${indice}`);

  if (indice >= count) {
    throw new Error(`Índice ${indice} fuera de rango. Solo hay ${count} filas.`);
  }

  // Scroll para asegurar visibilidad del botón
  await toggleButtons.nth(indice).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);

  // Cerrar cualquier dropdown abierto antes (clic en body)
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.waitForTimeout(300);

  // Clic en el toggle del índice correcto
  await toggleButtons.nth(indice).click();
  await page.waitForTimeout(800);

  // ─── ESPERAR MENÚ VISIBLE (append-to-body = está en el <body>) ────────────
  // El menú se inyecta en el body con display != none cuando está abierto
  const verPdfLink = page.locator('ul.dropdown-menu.wf-action-menu a.dropdown-drop', {
    hasText: 'Ver PDF'
  }).first();

  // Esperar que el menú sea visible en el body
  await verPdfLink.waitFor({ state: 'visible', timeout: 8000 });

  // ─── CAPTURAR RESPUESTA PDF ───────────────────────────────────────────────
  let pdfBase64 = null;

  context.on('response', async response => {
    if (response.url().includes('pdf-recepcion') && response.status() === 200) {
      try {
        const buffer = await response.body();
        pdfBase64 = buffer.toString('base64');
        console.log('PDF capturado via intercepción de red');
      } catch (e) {
        console.log('Error capturando respuesta:', e.message);
      }
    }
  });

  // ─── CLICK VER PDF ────────────────────────────────────────────────────────
  const [newPage] = await Promise.all([
    context.waitForEvent('page', { timeout: 15000 }).catch(() => null),
    verPdfLink.click()
  ]);

  await page.waitForTimeout(5000);

  // ─── CAPTURA FALLBACK ─────────────────────────────────────────────────────
  if (!pdfBase64 && newPage) {
    await newPage.waitForTimeout(4000);

    // Intento 1: iframe con botón descargar
    try {
      const iframe = newPage.frameLocator('iframe').first();
      const downloadPromise = newPage.waitForEvent('download', { timeout: 10000 }).catch(() => null);
      await iframe.getByRole('button', { name: 'Descargar' }).click({ timeout: 5000 });
      const download = await downloadPromise;
      if (download) {
        const stream = await download.createReadStream();
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        pdfBase64 = Buffer.concat(chunks).toString('base64');
        console.log('PDF capturado via descarga de iframe');
      }
    } catch (e) {
      console.log('Fallback iframe falló:', e.message);
    }

    // Intento 2: capturar PDF directo de la nueva página
    if (!pdfBase64) {
      try {
        const content = await newPage.content();
        if (content.includes('%PDF') || newPage.url().includes('.pdf')) {
          const buffer = await newPage.evaluate(async (url) => {
            const res = await fetch(url);
            const ab = await res.arrayBuffer();
            return Array.from(new Uint8Array(ab));
          }, newPage.url());
          pdfBase64 = Buffer.from(buffer).toString('base64');
          console.log('PDF capturado via fetch directo');
        }
      } catch (e) {
        console.log('Fallback fetch falló:', e.message);
      }
    }
  }

  // ─── GUARDAR O LANZAR ERROR CON SCREENSHOT ────────────────────────────────
  if (!fs.existsSync('output')) fs.mkdirSync('output');

  if (!pdfBase64) {
    const targetPage = newPage || page;
    await targetPage.screenshot({ path: 'output/debug.png', fullPage: true });
    console.log('Screenshot de debug guardado');
    throw new Error('No se pudo capturar el PDF por ningún método');
  }

  fs.writeFileSync(
    path.join('output', nombre_archivo + '.pdf'),
    Buffer.from(pdfBase64, 'base64')
  );

  console.log(`OK — PDF guardado: ${nombre_archivo}.pdf`);
  await browser.close();
})();
