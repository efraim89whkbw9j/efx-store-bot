// ============================================
// WHATSAPP BOT + SITE EFX STORE - ARQUIVO ÚNICO (BACKEND)
// ============================================
const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send("EFX Store Bot está online 🚀");
});
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// ========== CONFIGURAÇÃO DO SERVIDOR ==========
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = PORT;

// Configuração do multer para upload de arquivos
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const dir = './uploads';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir);
        cb(null, dir);
    },
    filename: function (req, file, cb) {
        cb(null, 'logo-' + Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// ========== BANCO DE DADOS SIMPLES (JSON) ==========
const DB_FILE = './database.json';

// Inicializar banco de dados se não existir
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({
        produtos: [],
        pedidos: [],
        configuracoes: {
            mensagens: {
                saudacao: "Olá 👋 Seja bem-vindo(a)! Sou seu vendedor virtual. Digite *catálogo* para ver produtos ou *comprar* para fazer um pedido 😊",
                fallback: "Não entendi. Digite *catálogo*, *promoções* ou *comprar*",
                catalogo_header: "📦 *NOSSOS PRODUTOS*\n\n",
                catalogo_footer: "\n\nPara comprar, digite *comprar [nome do produto]*"
            },
            pagamentos: [
                { nome: "Transferência Bancária", ativo: true, instrucoes: "Banco: BAI | IBAN: A0040 0000 61283833101 84" },
                { nome: "Multicaixa Express", ativo: true, instrucoes: "Número: 945935734" },
                { nome: "Pagar na Entrega", ativo: true, instrucoes: "Pagamento em cash no momento da entrega" }
            ],
            loja: {
                nome: "EFX Store",
                logo: "",
                descricao: "Bem-vindo à nossa loja!",
                whatsapp: "954312173"
            }
        }
    }, null, 2));
}

function readDB() {
    return JSON.parse(fs.readFileSync(DB_FILE));
}

function writeDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ========== SESSÕES DOS USUÁRIOS ==========
const userSessions = {};

// ========== CONEXÃO WHATSAPP ==========
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        printQRInTerminal: false,
        auth: state,
        browser: ['WhatsCommerce Bot', 'Chrome', '1.0.0']
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log('📱 QR Code gerado! Escaneie no painel admin');
            io.emit('qr', qr);
        }
        
        if (connection === 'open') {
            console.log('✅ WhatsApp Conectado!');
            io.emit('status', 'conectado');
        }
        
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
            io.emit('status', 'desconectado');
            if (shouldReconnect) connectToWhatsApp();
        }
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && m.type === 'notify') {
            await processMessage(sock, msg);
        }
    });

    return sock;
}

// ========== PROCESSADOR DE MENSAGENS ==========
async function processMessage(sock, msg) {
    const sender = msg.key.remoteJid;
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    const lowerText = text.toLowerCase().trim();
    
    const db = readDB();
    const config = db.configuracoes;
    
    // Verificar saudação
    if (lowerText.match(/^(oi|olá|ola|bom dia|boa tarde|boa noite|hello)$/i)) {
        await sock.sendMessage(sender, { text: config.mensagens.saudacao });
        return;
    }
    
    // Comando CATÁLOGO
    if (lowerText.includes('catálogo') || lowerText.includes('catalogo') || lowerText.includes('produtos')) {
        let resposta = config.mensagens.catalogo_header;
        db.produtos.filter(p => p.status === 'disponivel').forEach((p, i) => {
            resposta += `${i+1}. *${p.nome}* - R$ ${p.preco}\n   ${p.descricao.substring(0, 50)}...\n`;
        });
        resposta += config.mensagens.catalogo_footer;
        await sock.sendMessage(sender, { text: resposta });
        return;
    }
    
    // Comando PROMOÇÕES
    if (lowerText.includes('promoções') || lowerText.includes('promocoes')) {
        const promos = db.produtos.filter(p => p.promocao === true);
        if (promos.length > 0) {
            let resposta = "🔥 *PROMOÇÕES ESPECIAIS*\n\n";
            promos.forEach(p => {
                resposta += `*${p.nome}* - De R$ ${p.preco_original} por R$ ${p.preco}\n`;
            });
            await sock.sendMessage(sender, { text: resposta });
        } else {
            await sock.sendMessage(sender, { text: "No momento não temos promoções ativas. Digite *catálogo* para ver todos os produtos!" });
        }
        return;
    }
    
    // Comando COMPRAR
    if (lowerText.includes('comprar') || lowerText.includes('quero comprar')) {
        const produtoNome = lowerText.replace('comprar', '').replace('quero comprar', '').trim();
        
        if (produtoNome) {
            const produto = db.produtos.find(p => 
                p.nome.toLowerCase().includes(produtoNome) && p.status === 'disponivel'
            );
            
            if (produto) {
                userSessions[sender] = {
                    step: 'aguardando_nome',
                    produto: produto
                };
                await sock.sendMessage(sender, { text: `Ótima escolha! O *${produto.nome}* custa R$ ${produto.preco}. Para finalizar, qual é o seu nome?` });
            } else {
                await sock.sendMessage(sender, { text: "Produto não encontrado ou indisponível. Digite *catálogo* para ver os produtos disponíveis." });
            }
        } else {
            await sock.sendMessage(sender, { text: "Qual produto você quer comprar? Digite *comprar [nome do produto]*" });
        }
        return;
    }
    
    // Como pagar?
    if (lowerText.includes('como pagar') || lowerText.includes('pagamento')) {
        let resposta = "💰 *FORMAS DE PAGAMENTO*\n\n";
        config.pagamentos.filter(p => p.ativo).forEach((p, i) => {
            resposta += `${i+1}. ${p.nome}\n   ${p.instrucoes}\n\n`;
        });
        await sock.sendMessage(sender, { text: resposta });
        return;
    }
    
    // Entrega?
    if (lowerText.includes('entrega') || lowerText.includes('prazo')) {
        await sock.sendMessage(sender, { text: "🚚 *ENTREGA*\n\nPrazo: 2-3 dias úteis\nTaxa: 500kz (ou grátis para compras acima de 20.000)\nEntregamos em toda cidade!" });
        return;
    }
    
    // Preço?
    if (lowerText.includes('preço') || lowerText.includes('preco') || lowerText.includes('quanto custa')) {
        const produtoNome = lowerText.replace('preço', '').replace('preco', '').replace('quanto custa', '').trim();
        const produto = db.produtos.find(p => p.nome.toLowerCase().includes(produtoNome));
        if (produto) {
            await sock.sendMessage(sender, { text: `O *${produto.nome}* custa R$ ${produto.preco} e está ${produto.status === 'disponivel' ? '✅ disponível' : '❌ esgotado'}` });
        } else {
            await sock.sendMessage(sender, { text: "Qual produto você quer saber o preço? Digite o nome." });
        }
        return;
    }
    
    // FLUXO DE COMPRA (sessão ativa)
    if (userSessions[sender]) {
        const session = userSessions[sender];
        
        if (session.step === 'aguardando_nome') {
            session.nome = text;
            session.step = 'aguardando_endereco';
            await sock.sendMessage(sender, { text: `Prazer, ${session.nome}! Qual é o seu endereço completo para entrega?` });
            return;
        }
        
        if (session.step === 'aguardando_endereco') {
            session.endereco = text;
            session.step = 'aguardando_pagamento';
            
            let pagamentos = config.pagamentos.filter(p => p.ativo).map((p, i) => `${i+1}. ${p.nome}`).join('\n');
            await sock.sendMessage(sender, { text: `Endereço anotado! Agora escolha a forma de pagamento:\n\n${pagamentos}\n\nDigite apenas o número da opção.` });
            return;
        }
        
        if (session.step === 'aguardando_pagamento') {
            const opcao = parseInt(text) - 1;
            const pagamentos = config.pagamentos.filter(p => p.ativo);
            
            if (opcao >= 0 && opcao < pagamentos.length) {
                const pagamento = pagamentos[opcao];
                
                // Criar pedido
                const pedido = {
                    id: Date.now(),
                    cliente: session.nome,
                    telefone: sender.split('@')[0],
                    produto: session.produto,
                    endereco: session.endereco,
                    pagamento: pagamento.nome,
                    data: new Date().toLocaleString(),
                    status: 'novo'
                };
                
                db.pedidos.push(pedido);
                writeDB(db);
                
                // Resumo final
                const resumo = `
✅ *PEDIDO CONFIRMADO!*

*Resumo:*
Cliente: ${pedido.cliente}
Produto: ${pedido.produto.nome}
Preço: R$ ${pedido.produto.preco}
Endereço: ${pedido.endereco}
Pagamento: ${pedido.pagamento}

💰 *INSTRUÇÕES DE PAGAMENTO:*
${pagamento.instrucoes}

Após o pagamento, aguarde que confirmaremos seu pedido!
Obrigado pela compra! 🎉
                `;
                
                await sock.sendMessage(sender, { text: resumo });
                delete userSessions[sender];
                
                // Avisar admin (opcional)
                io.emit('novo_pedido', pedido);
            } else {
                await sock.sendMessage(sender, { text: "Opção inválida. Digite apenas o número da forma de pagamento." });
            }
            return;
        }
    }
    
    // Mensagem padrão se não entendeu
    await sock.sendMessage(sender, { text: config.mensagens.fallback });
}

// ========== ROTAS DA API ==========
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Servir o frontend (index.html) para todas as rotas não-API
app.get(['/', '/admin'], (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ===== ROTAS DE PRODUTOS =====
app.get('/api/produtos', (req, res) => {
    const db = readDB();
    res.json(db.produtos);
});

app.post('/api/produtos', (req, res) => {
    const senha = req.headers['x-admin-senha'];
    if (senha !== 'admin123') {
        return res.status(401).json({ erro: 'Não autorizado' });
    }
    const db = readDB();
    const produto = {
        id: Date.now(),
        ...req.body,
        status: req.body.status || 'disponivel'
    };
    db.produtos.push(produto);
    writeDB(db);
    res.json(produto);
});

app.put('/api/produtos/:id', (req, res) => {
    const senha = req.headers['x-admin-senha'];
    if (senha !== 'admin123') {
        return res.status(401).json({ erro: 'Não autorizado' });
    }
    const db = readDB();
    const id = parseInt(req.params.id);
    const index = db.produtos.findIndex(p => p.id === id);
    if (index !== -1) {
        db.produtos[index] = { ...db.produtos[index], ...req.body };
        writeDB(db);
        res.json(db.produtos[index]);
    } else {
        res.status(404).json({ erro: 'Produto não encontrado' });
    }
});

app.delete('/api/produtos/:id', (req, res) => {
    const senha = req.headers['x-admin-senha'];
    if (senha !== 'admin123') {
        return res.status(401).json({ erro: 'Não autorizado' });
    }
    const db = readDB();
    const id = parseInt(req.params.id);
    db.produtos = db.produtos.filter(p => p.id !== id);
    writeDB(db);
    res.json({ ok: true });
});

// ===== ROTAS DE PEDIDOS =====
app.get('/api/pedidos', (req, res) => {
    const db = readDB();
    res.json(db.pedidos);
});

// ===== ROTAS DE CONFIGURAÇÕES =====
app.get('/api/configuracoes', (req, res) => {
    const db = readDB();
    res.json(db.configuracoes);
});

app.post('/api/configuracoes', (req, res) => {
    const senha = req.headers['x-admin-senha'];
    if (senha !== 'admin123') {
        return res.status(401).json({ erro: 'Não autorizado' });
    }
    const db = readDB();
    db.configuracoes = { ...db.configuracoes, ...req.body };
    writeDB(db);
    res.json(db.configuracoes);
});

// ===== ROTAS DA LOJA =====
app.get('/api/loja', (req, res) => {
    const db = readDB();
    res.json(db.configuracoes.loja);
});

app.post('/api/loja', (req, res) => {
    const senha = req.headers['x-admin-senha'];
    if (senha !== 'admin123') {
        return res.status(401).json({ erro: 'Não autorizado' });
    }
    const db = readDB();
    db.configuracoes.loja = { ...db.configuracoes.loja, ...req.body };
    writeDB(db);
    res.json(db.configuracoes.loja);
});

app.post('/api/upload/logo', upload.single('logo'), (req, res) => {
    const senha = req.headers['x-admin-senha'];
    if (senha !== 'efraim321') {
        return res.status(401).json({ erro: 'Não autorizado' });
    }
    if (!req.file) {
        return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
    }
    const db = readDB();
    const logoUrl = `/uploads/${req.file.filename}`;
    db.configuracoes.loja.logo = logoUrl;
    writeDB(db);
    res.json({ logo: logoUrl });
});

// ========== INICIAR SERVIDOR ==========
 const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Servidor HTTP rodando na porta", PORT);
});
