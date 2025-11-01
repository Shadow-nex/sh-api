const express = require('express');
const chalk = require('chalk');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const axios = require('axios');

require("./function.js");

const app = express();
const PORT = process.env.PORT || 8080;

// Cambia tu webhook de Discord aquí:
const WEBHOOK_URL = 'https://discord.com/api/webhooks/1396122030163628112/-vEj4HjREjbaOVXDu5932YjeHpTkjNSKyUKugBFF9yVCBeQSrdgK8qM3HNxVYTOD5BYP';

// Buffer para agrupar logs
let logBuffer = [];

// Enviar lote de logs cada 2 segundos
setInterval(() => {
    if (logBuffer.length === 0) return;

    const combinedLogs = logBuffer.join('\n');
    logBuffer = [];

    const payload =
` \`\`\`ansi
${combinedLogs}
\`\`\`
`;

    axios.post(WEBHOOK_URL, { content: payload }).catch(console.error);
}, 2000);

// Función de cola de logs
function queueLog({ method, status, url, duration, error = null }) {
    let colorCode;
    if (status >= 500) colorCode = '[2;31m';
    else if (status >= 400) colorCode = '[2;31m';
    else if (status === 304) colorCode = '[2;34m';
    else colorCode = '[2;32m';

    let line = `${colorCode}[${method}] ${status} ${url} - ${duration}ms[0m`;

    if (error) {
        line += `\n[2;31m[ERROR] ${error.message || error}[0m`;
    }

    logBuffer.push(line);
}

// Variables de cooldown
let requestCount = 0;
let isCooldown = false;

setInterval(() => {
    requestCount = 0;
}, 1000);

app.use((req, res, next) => {
    if (isCooldown) {
        queueLog({
            method: req.method,
            status: 503,
            url: req.originalUrl,
            duration: 0,
            error: 'El servidor está en enfriamiento'
        });
        return res.status(503).json({ error: 'El servidor está en enfriamiento, inténtalo más tarde.' });
    }

    requestCount++;

    if (requestCount > 10) {
        isCooldown = true;
        const cooldownTime = (Math.random() * (120000 - 60000) + 60000).toFixed(3);

        console.log(`⚠️ DETECTADO SPAM: Enfriamiento de ${cooldownTime / 1000} segundos`);
        const userTag = '<@1162931657276395600>';
        const spamMsg =
`${userTag}
\`\`\`ansi
⚠️ [ DETECTADO SPAM ] ⚠️

[ ! ] Demasiadas solicitudes, el servidor entra en enfriamiento por ${cooldownTime / 1000} segundos!

[2;31m[${req.method}] 503 ${req.originalUrl} - 0ms[0m
\`\`\`
`;

        axios.post(WEBHOOK_URL, { content: spamMsg }).catch(console.error);

        setTimeout(() => {
            isCooldown = false;
            console.log('✅ Enfriamiento terminado, servidor activo nuevamente');
        }, cooldownTime);

        return res.status(503).json({ error: '¡Demasiadas solicitudes, servidor en enfriamiento!' });
    }

    next();
});

app.enable("trust proxy");
app.set("json spaces", 2);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors());

// Cargar configuración
const settingsPath = path.join(__dirname, './assets/settings.json');
const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
global.apikey = settings.apiSettings.apikey;

// Log personalizado + envolver res.json + agrupar logs de todas las respuestas
app.use((req, res, next) => {
    console.log(chalk.bgHex('#FFFF99').hex('#333').bold(` Ruta solicitada: ${req.path} `));
    global.totalreq += 1;

    const start = Date.now();
    const originalJson = res.json;

    res.json = function (data) {
        if (data && typeof data === 'object') {
            const responseData = {
                status: data.status,
                creator: settings.apiSettings.creator || "FlowFalcon",
                ...data
            };
            return originalJson.call(this, responseData);
        }
        return originalJson.call(this, data);
    };

    res.on('finish', () => {
        const duration = Date.now() - start;

        queueLog({
            method: req.method,
            status: res.statusCode,
            url: req.originalUrl,
            duration
        });
    });

    next();
});

// Archivos estáticos y protección de /src
app.use('/', express.static(path.join(__dirname, 'api-page')));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

app.use('/src', (req, res) => {
    res.status(403).json({ error: 'Acceso prohibido' });
});

// Cargar rutas de API de forma dinámica desde src/api/
let totalRoutes = 0;
const apiFolder = path.join(__dirname, './src/api');
fs.readdirSync(apiFolder).forEach((subfolder) => {
    const subfolderPath = path.join(apiFolder, subfolder);
    if (fs.statSync(subfolderPath).isDirectory()) {
        fs.readdirSync(subfolderPath).forEach((file) => {
            const filePath = path.join(subfolderPath, file);
            if (path.extname(file) === '.js') {
                require(filePath)(app);
                totalRoutes++;
                console.log(chalk.bgHex('#FFFF99').hex('#333').bold(` Ruta cargada: ${path.basename(file)} `));
            }
        });
    }
});

console.log(chalk.bgHex('#90EE90').hex('#333').bold(' ¡Carga completa! ✓ '));
console.log(chalk.bgHex('#90EE90').hex('#333').bold(` Total de rutas cargadas: ${totalRoutes} `));

// Ruta principal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'api-page', 'index.html'));
});

// Manejadores de error 404 y 500 + log agrupado
app.use((req, res, next) => {
    queueLog({
        method: req.method,
        status: 404,
        url: req.originalUrl,
        duration: 0,
        error: 'No encontrado'
    });

    res.status(404).sendFile(process.cwd() + "/api-page/404.html");
});

app.use((err, req, res, next) => {
    console.error(err.stack);

    queueLog({
        method: req.method,
        status: 500,
        url: req.originalUrl,
        duration: 0,
        error: err
    });

    res.status(500).sendFile(process.cwd() + "/api-page/500.html");
});

app.listen(PORT, () => {
    console.log(chalk.bgHex('#90EE90').hex('#333').bold(` Servidor ejecutándose en el puerto ${PORT} `));
});

module.exports = app;