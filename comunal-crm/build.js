// Build script: inyecta las variables de entorno de Vercel en los HTML
const fs = require('fs');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('⚠️  Faltan SUPABASE_URL o SUPABASE_KEY en variables de entorno');
  process.exit(1);
}

const inject = `<script>window.SUPABASE_URL='${SUPABASE_URL}';window.SUPABASE_KEY='${SUPABASE_KEY}';</script>`;

['index.html', 'app.html'].forEach(file => {
  let html = fs.readFileSync(file, 'utf8');
  html = html.replace('<head>', '<head>\n' + inject);
  fs.writeFileSync(file, html);
  console.log(`✅ ${file} actualizado`);
});

console.log('Build completado');
