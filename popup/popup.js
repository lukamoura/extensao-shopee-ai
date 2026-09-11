'use strict';

const inputChave = document.getElementById('inputChave');
const inputModelo = document.getElementById('inputModelo');
const avisoSalvo = document.getElementById('avisoSalvo');

const enviar = (msg) => chrome.runtime.sendMessage(msg);

let provedorAberto = 'gemini';
let configIA = null;

async function carregarConfigIA() {
  configIA = await enviar({ tipo: 'LER_CONFIG_IA' });
  provedorAberto = configIA.provedor;
  pintarAbas();
}

function pintarAbas() {
  if (!configIA) return;

  for (const aba of document.querySelectorAll('.chave__aba')) {
    const ativo = aba.dataset.provedor === provedorAberto;
    aba.classList.toggle('chave__aba--ativa', ativo);
    aba.setAttribute('aria-selected', String(ativo));
    aba.dataset.marcado = configIA.temChave[aba.dataset.provedor] ? 'sim' : 'nao';
  }

  const info = configIA.provedores[provedorAberto];
  if (!info) return;
  const temChave = configIA.temChave[provedorAberto];

  document.getElementById('notaProvedor').textContent =
    info.ondePegar + (temChave ? ' · chave salva' : '');

  inputChave.value = '';
  inputChave.placeholder = temChave
    ? '•••••••• (salva — preencha só para trocar)'
    : provedorAberto === 'gemini'
      ? 'AQ.A… ou AIza…'
      : provedorAberto === 'openrouter'
        ? 'sk-or-v1-…'
        : 'sk-ant-…';

  inputModelo.value =
    provedorAberto === configIA.provedor ? configIA.modelo : info.modeloPadrao;
  inputModelo.placeholder = info.modeloPadrao;

  document.getElementById('btnApagarChave').hidden = !temChave;
}

function piscarSalvo() {
  avisoSalvo.hidden = false;
  setTimeout(() => (avisoSalvo.hidden = true), 1600);
}

for (const aba of document.querySelectorAll('.chave__aba')) {
  aba.onclick = () => {
    provedorAberto = aba.dataset.provedor;
    pintarAbas();
  };
}

document.getElementById('btnSalvarChave').onclick = async () => {
  await enviar({
    tipo: 'SALVAR_CONFIG_IA',
    provedor: provedorAberto,
    chave: inputChave.value.trim() || undefined,
    modelo: inputModelo.value.trim() || undefined,
  });
  await carregarConfigIA();
  piscarSalvo();
};

document.getElementById('btnApagarChave').onclick = async () => {
  await enviar({ tipo: 'SALVAR_CONFIG_IA', provedor: provedorAberto, apagarChave: true });
  await carregarConfigIA();
};

carregarConfigIA();
