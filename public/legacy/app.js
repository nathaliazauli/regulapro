
// ══════════════════════════════════════════════
// RegulaPro — backend Supabase
// Este arquivo é a versão convertida do app.js original: toda a
// persistência (antes em localStorage) agora usa o cliente oficial do
// Supabase, exposto em `window.supabase` pelo componente AppBootstrap.
// ══════════════════════════════════════════════
const supabase = window.supabase;
if(!supabase){
  console.error('RegulaPro: window.supabase não foi encontrado. Verifique se NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY estão definidos em .env.local.');
}

const COLABS = {
  ana:  {nome:'Ana',       ini:'AN', cor:'#0ea5e9', bg:'#e0f5fe', dark:'#0369a1'},
  bea:  {nome:'Beatriz',   ini:'BE', cor:'#d946ef', bg:'#fce7ff', dark:'#a21caf'},
  car:  {nome:'Carla',     ini:'CA', cor:'#10b981', bg:'#d1fae5', dark:'#047857'},
  dan:  {nome:'Daniela',   ini:'DA', cor:'#f59e0b', bg:'#fef3c7', dark:'#b45309'},
  eli:  {nome:'Elisabete', ini:'EL', cor:'#6366f1', bg:'#e0e7ff', dark:'#4338ca'},
  fab:  {nome:'Fabiana',   ini:'FA', cor:'#f43f5e', bg:'#ffe4e6', dark:'#be123c'},
};

const ETAPAS = [
  {key:'val', nome:'Validação Regulatória', cls:'e-val', cor:'#6366f1'},
  {key:'rot', nome:'Liberação de Rotulagem', cls:'e-rot', cor:'#f59e0b'},
  {key:'art', nome:'Conferência de Arte',    cls:'e-art', cor:'#ec4899'},
  {key:'anv', nome:'Notificação ANVISA',     cls:'e-anv', cor:'#0ea5e9'},
  {key:'pos', nome:'Etapas Pós-ANVISA',      cls:'e-pos', cor:'#10b981'},
];

const SETORES = ['INTERNO - DESIGNERS','INTERNO - LOGÍSTICA','INTERNO - MKT','INTERNO - P&D','INTERNO - PCP','INTERNO - PROJETOS','INTERNO - QUALIDADE','INTERNO - REGULATÓRIOS'];

// USERS/PROFILES — agora vem da tabela `profiles` (vinculada a auth.users
// do Supabase). USERS mantém o mesmo formato { [username]: {nome,ini,role} }
// usado pelo restante do código (renderUsers, toggle de papel, etc.), só
// que agora é preenchido a partir do Supabase em vez de localStorage.
let USERS = {};
let PROFILES_BY_ID = {}; // username -> profile row completo (id, email, role...)

async function loadUsers(){
  try{
    const { data, error } = await supabase.from('profiles').select('*').order('created_at');
    if(error) throw error;
    USERS = {}; PROFILES_BY_ID = {};
    (data||[]).forEach(p=>{
      USERS[p.username] = { nome:p.nome, ini:p.ini, role:p.role, email:p.email, active:p.active };
      PROFILES_BY_ID[p.username] = p;
    });
  }catch(e){ console.error('Erro ao carregar usuários do Supabase:', e); }
}
function saveUsers(){ /* no-op: profiles são gravados individualmente (ver toggleUserRole) */ }


let CU = null;
let DATA = [];
let openProductIds = new Set(); // tracks which products are currently expanded in Painel de Produtos
let retroCtx = null;
let fColab = 'all', fStatus = 'all';
let biSort = {col:'nome', dir:1};
let biFilt = {};

// ── DATA ──
// loadData() agora é o "bootstrap" único: busca TODOS os domínios de dados
// do Supabase em paralelo e popula as mesmas variáveis globais que o resto
// do código já usa (DATA, MP_DATA, PR_DATA, LISTS, CHECKLIST_BASE, SLA,
// FERIADOS, AGENDA). As demais funções loadX() viram no-ops (ver abaixo de
// cada domínio) porque os dados já estão todos na memória depois disto.
async function loadData(){
  await loadUsers();
  await Promise.all([
    loadSLA(),
    fetchLists(),
    fetchChecklistBase(),
    fetchPRData(),
    fetchMP(),
    loadAgendaFromServer(),
  ]);

  try{
    const { data, error } = await supabase.from('products').select('*').order('created_at');
    if(error) throw error;
    DATA = (data||[]).map(fromProductRow);
  }catch(e){ console.error('Erro ao carregar produtos do Supabase:', e); DATA = []; }

  if(!DATA.length){
    DATA=[
      mkProd('Sérum Vitamina C 20%','ana','GRANADO','TRATAMENTO','SÉRUM'),
      mkProd('Hidratante Labial SPF15','bea','PHEBO','PERFUMARIA PHEBO','BALM LABIAL'),
      mkProd('Shampoo Antiqueda','car','GRANADO','TRATAMENTO','SHAMPOO'),
      mkProd('Protetor Solar FPS70','ana','CARE','CARE','PROTETOR SOLAR'),
      mkProd('Condicionador Nutritivo','dan','GRANADO','TRATAMENTO','CONDICIONADOR'),
    ];
    // Demo data
    DATA[0].etapas.val.status='concluida'; DATA[0].etapas.rot.status='concluida';
    DATA[0].etapas.art.status='em-andamento';
    DATA[0].etapas.anv.retrocessos.push({data:'2024-03-10',etapa:'anv',setor:'INTERNO - REGULATÓRIOS',motivo:'Documentação incompleta'});
    DATA[0].etapas.anv.retornoEtapas=[{entrada:'',prazoInterno:'',prazoExterno:'',inicio:'',fim:'',status:'nao-iniciada',isRetorno:true,retroRef:0}];
    DATA[2].etapas.rot.retrocessos.push({data:'2024-02-15',etapa:'rot',setor:'INTERNO - DESIGNERS',motivo:'Erro no texto do rótulo'});
    DATA[2].etapas.rot.retornoEtapas=[{entrada:'',prazoInterno:'',prazoExterno:'',inicio:'',fim:'',status:'nao-iniciada',isRetorno:true,retroRef:0}];
    DATA[4].prioridade=true;
    save();
  }
  await checkDailyBackup();
}

// Converte um produto (formato usado em memória pelo app) numa linha da
// tabela `products` do Supabase.
function toProductRow(p){
  return {
    id: p.id,
    nome: p.nome,
    colab: p.colab || 'inbox',
    marca: p.marca || '',
    linha: p.linha || '',
    tipo: p.tipo || '',
    prioridade: !!p.prioridade,
    ag_esgotamento: !!p.agEsgotamento,
    is_kit: !!p.isKit,
    kit_items: p.kitItems || [],
    etapas: p.etapas || {},
    realoc_history: p.realocHistory || [],
  };
}

// Converte uma linha da tabela `products` de volta para o formato em
// memória usado pelo restante da aplicação.
function fromProductRow(r){
  return {
    id: r.id,
    nome: r.nome,
    colab: r.colab || 'inbox',
    marca: r.marca || '',
    linha: r.linha || '',
    tipo: r.tipo || '',
    prioridade: !!r.prioridade,
    agEsgotamento: !!r.ag_esgotamento,
    isKit: !!r.is_kit,
    kitItems: r.kit_items || [],
    etapas: r.etapas || {},
    realocHistory: r.realoc_history || [],
  };
}

// save() grava TODO o array DATA no Supabase (substitui o conteúdo da
// tabela `products`), preservando o modelo mental original em que o array
// em memória é a fonte da verdade — inclusive para exclusões de produtos.
async function save(){
  try{
    const { error: delErr } = await supabase.from('products').delete().not('id', 'is', null);
    if(delErr) throw delErr;
    if(DATA.length){
      const { error: insErr } = await supabase.from('products').insert(DATA.map(toProductRow));
      if(insErr) throw insErr;
    }
  }catch(e){ console.error('Erro ao salvar produtos no Supabase:', e); }
  if(document.getElementById('page-demandas')?.classList.contains('active')) renderPainelDemandas();
}

// ── BACKUP DIÁRIO ──
// O backup passa a ser gravado como um objeto JSON no bucket privado
// `backups` do Supabase Storage (em vez de apenas um download local), além
// de continuar oferecendo o download + rascunho de e-mail como antes.
const BACKUP_EMAIL='g_regulatorio@granadophebo.com.br';
async function getAppSetting(key, fallback){
  try{
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', key).maybeSingle();
    if(error) throw error;
    return data ? data.value : fallback;
  }catch(e){ console.error('Erro ao ler app_settings:', e); return fallback; }
}
async function setAppSetting(key, value){
  try{
    const { error } = await supabase.from('app_settings').upsert({ key, value });
    if(error) throw error;
  }catch(e){ console.error('Erro ao gravar app_settings:', e); }
}

async function checkDailyBackup(){
  const last = await getAppSetting('last_backup_date', null);
  const today = new Date().toISOString().split('T')[0];
  window._backupPendente = last !== today;
  const banner=document.getElementById('backup-banner');
  if(banner) banner.style.display = window._backupPendente ? 'flex' : 'none';
}
function gerarBackupJSON(){
  const backup={
    data_exportacao:new Date().toISOString(),
    produtos:DATA,
    usuarios:Object.fromEntries(Object.entries(USERS).map(([u,d])=>[u,{nome:d.nome,role:d.role}])), // sem senhas
    sla:SLA,
    feriados:FERIADOS
  };
  return JSON.stringify(backup,null,2);
}
async function dispararBackupEmail(){
  const json=gerarBackupJSON();
  const today=new Date().toISOString().split('T')[0];

  // 1) Envia o backup para o Supabase Storage (bucket privado "backups").
  try{
    const blobForStorage=new Blob([json],{type:'application/json'});
    const path=`regulapro_backup_${today}.json`;
    const { error: upErr } = await supabase.storage.from('backups').upload(path, blobForStorage, {
      contentType:'application/json', upsert:true,
    });
    if(upErr) throw upErr;
  }catch(e){ console.error('Erro ao enviar backup para o Supabase Storage:', e); }

  // 2) Mantém o download local + rascunho de e-mail (não é possível enviar
  //    e-mails automaticamente a partir do navegador por segurança).
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=`regulapro_backup_${today}.json`;a.click();

  const subject=encodeURIComponent('RegulaPro — Backup Diário '+today);
  const body=encodeURIComponent(
    'Backup automático do RegulaPro gerado em '+new Date().toLocaleString('pt-BR')+'.\n\n'+
    'O arquivo de backup (regulapro_backup_'+today+'.json) foi baixado no seu computador e também\n'+
    'foi salvo no Supabase Storage, bucket "backups".\n\n'+
    'Total de produtos: '+DATA.length+'\n'+
    '— Enviado automaticamente pelo RegulaPro'
  );
  window.open(`mailto:${BACKUP_EMAIL}?subject=${subject}&body=${body}`,'_blank');

  await setAppSetting('last_backup_date', today);
  window._backupPendente=false;
  const banner=document.getElementById('backup-banner');
  if(banner) banner.style.display='none';
}
function dismissBackupBanner(){
  const banner=document.getElementById('backup-banner');
  if(banner) banner.style.display='none';
}
async function updateBackupInfo(){
  const el=document.getElementById('backup-last-info');
  if(!el) return;
  const last = await getAppSetting('last_backup_date', null);
  if(last){
    const dt=new Date(last+'T12:00:00');
    el.textContent='Último backup enviado em: '+dt.toLocaleDateString('pt-BR');
  } else {
    el.textContent='Nenhum backup foi enviado ainda.';
  }
}

function mkProd(nome,colab,marca,linha,tipo){
  const etapas={};
  ETAPAS.forEach(e=>{ etapas[e.key]={status:'nao-iniciada',entrada:'',prazoInterno:'',prazoExterno:'',inicio:'',fim:'',retrocessos:[],retornoEtapas:[]}; });
  return {id:Date.now()+Math.random(),nome,colab:colab||'inbox',marca:marca||'',linha:linha||'',tipo:tipo||'',prioridade:false,agEsgotamento:false,etapas,realocHistory:[]};
}


// ══════════════════════════════════════════════
// ── CHECKLIST BASE (Admin editável) ──
// ══════════════════════════════════════════════
// Structure: { val:[{id,text},{...}], rot:[...], ... }
let CHECKLIST_BASE = {};

function defaultChecklistBase(){
  return {
    val:[
      {id:'v1',text:'Verificar documentação técnica completa'},
      {id:'v2',text:'Conferir fórmula aprovada e laudos'},
      {id:'v3',text:'Validar ingredientes e concentrações regulatórias'},
      {id:'v4',text:'Confirmar categoria do produto (notificação/registro)'},
      {id:'v5',text:'Revisar claims e restrições de uso'},
    ],
    rot:[
      {id:'r1',text:'Verificar dados obrigatórios no rótulo (INCI, validade, lote)'},
      {id:'r2',text:'Confirmar idioma e tradução do rótulo'},
      {id:'r3',text:'Revisar tamanho da fonte e legibilidade'},
      {id:'r4',text:'Checar embalagem primária vs. secundária'},
      {id:'r5',text:'Validar número de registro/notificação no rótulo'},
    ],
    art:[
      {id:'a1',text:'Conferir arte final vs. rótulo aprovado'},
      {id:'a2',text:'Verificar cores, logo e identidade visual'},
      {id:'a3',text:'Validar textos regulatórios na arte'},
      {id:'a4',text:'Confirmar aprovação com equipe de MKT'},
    ],
    anv:[
      {id:'n1',text:'Acessar sistema ANVISA (SINARC/SINEP)'},
      {id:'n2',text:'Preencher formulário de notificação corretamente'},
      {id:'n3',text:'Anexar documentação técnica obrigatória'},
      {id:'n4',text:'Confirmar protocolo e número de notificação gerado'},
      {id:'n5',text:'Arquivar comprovante no dossiê do produto'},
    ],
    pos:[
      {id:'p1',text:'Confirmar número ANVISA ativo e válido'},
      {id:'p2',text:'Comunicar liberação para equipe de logística/PCP'},
      {id:'p3',text:'Atualizar planilha de controle de registros'},
      {id:'p4',text:'Arquivar dossiê completo do produto'},
    ],
  };
}

async function fetchChecklistBase(){
  try{
    const { data, error } = await supabase.from('checklist_base').select('*');
    if(error) throw error;
    if(data && data.length){
      CHECKLIST_BASE = {};
      data.forEach(row=>{ CHECKLIST_BASE[row.etapa_key] = row.items || []; });
    } else {
      CHECKLIST_BASE = defaultChecklistBase();
      await saveChecklistBase();
    }
  }catch(e){ console.error('Erro ao carregar checklist_base do Supabase:', e); CHECKLIST_BASE = defaultChecklistBase(); }
}
// Compatibilidade: os dados já são carregados uma vez em loadData() (bootstrap).
// As demais chamadas espalhadas pelo código (renderChecklistAdmin, openChecklist, etc.)
// viram no-op síncrono — CHECKLIST_BASE já está atualizado em memória.
function loadChecklistBase(){}

async function saveChecklistBase(){
  try{
    const rows = Object.keys(CHECKLIST_BASE).map(k=>({ etapa_key:k, items:CHECKLIST_BASE[k] }));
    const { error } = await supabase.from('checklist_base').upsert(rows);
    if(error) throw error;
  }catch(e){ console.error('Erro ao salvar checklist_base no Supabase:', e); }
}

// ── RENDER ADMIN CHECKLIST EDITOR ──
let openChecklistEtapas = new Set(); // persists which etapa blocks are expanded in admin checklist editor

function renderChecklistAdmin(){
  const el=document.getElementById('checklist-admin-body');
  if(!el) return;
  loadChecklistBase();
  el.innerHTML=ETAPAS.map(e=>{
    const items=CHECKLIST_BASE[e.key]||[];
    const isOpen=openChecklistEtapas.has(e.key);
    return`<div class="checklist-etapa-block">
      <div class="checklist-etapa-title" style="cursor:pointer" onclick="toggleChecklistEtapaBlock('${e.key}')">
        <span class="toggle-ic${isOpen?'':' rot'}" id="clb-ic-${e.key}">▾</span>
        <div style="width:10px;height:10px;border-radius:50%;background:${e.cor};flex-shrink:0"></div>
        ${e.nome}
        <span style="font-size:11px;color:var(--text3);font-weight:400;margin-left:auto">${items.length} item${items.length!==1?'s':''}</span>
      </div>
      <div id="clb-body-${e.key}" style="display:${isOpen?'block':'none'}">
        <div class="checklist-edit-list" id="cl-admin-list-${e.key}">
          ${items.map((it,i)=>`
            <div class="checklist-edit-item" id="cl-item-${e.key}-${i}">
              <span style="font-size:11px;color:var(--text3);font-family:var(--mono);width:18px;text-align:right;flex-shrink:0">${i+1}.</span>
              <input type="text" value="${it.text.replace(/"/g,'&quot;')}"
                onchange="updateChecklistItem('${e.key}',${i},this.value)"
                style="flex:1;font-size:12.5px;padding:5px 9px">
              <button onclick="removeChecklistItem('${e.key}',${i})" title="Remover item">✕</button>
            </div>`).join('')}
        </div>
        <div class="checklist-add-row">
          <input type="text" id="cl-new-${e.key}" placeholder="+ Novo item de verificação..."
            onkeydown="if(event.key==='Enter')addChecklistItem('${e.key}')"
            style="flex:1;font-size:12.5px;padding:5px 9px">
          <button class="btn sm primary" onclick="addChecklistItem('${e.key}')">Adicionar</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleChecklistEtapaBlock(ek){
  const body=document.getElementById('clb-body-'+ek);
  const ic=document.getElementById('clb-ic-'+ek);
  if(!body) return;
  const hidden=body.style.display==='none'||body.style.display==='';
  body.style.display=hidden?'block':'none';
  if(ic) ic.classList.toggle('rot',!hidden);
  if(hidden) openChecklistEtapas.add(ek);
  else openChecklistEtapas.delete(ek);
}

function addChecklistItem(ek){
  const input=document.getElementById('cl-new-'+ek);
  const text=(input?.value||'').trim();
  if(!text){input?.focus();return;}
  if(!CHECKLIST_BASE[ek]) CHECKLIST_BASE[ek]=[];
  const id=ek+'_'+Date.now();
  CHECKLIST_BASE[ek].push({id,text});
  saveChecklistBase();
  input.value='';
  renderChecklistAdmin();
  // re-focus the input for that etapa
  setTimeout(()=>{ const el=document.getElementById('cl-new-'+ek); if(el) el.focus(); },50);
}

function removeChecklistItem(ek,idx){
  if(!CHECKLIST_BASE[ek]) return;
  CHECKLIST_BASE[ek].splice(idx,1);
  saveChecklistBase();
  renderChecklistAdmin();
}

function updateChecklistItem(ek,idx,val){
  if(!CHECKLIST_BASE[ek]) return;
  CHECKLIST_BASE[ek][idx].text=val;
  saveChecklistBase();
}

// ══════════════════════════════════════════════
// ── CHECKLIST MODAL (ao concluir etapa) ──
// ══════════════════════════════════════════════
let clCtx=null; // {pid, ek, rIdx, items:[{id,text,checked}]}

function openChecklist(pid, ek, rIdx){
  loadChecklistBase();
  const p=DATA.find(x=>x.id==pid); if(!p) return;
  const etapa=ETAPAS.find(e=>e.key===ek); if(!etapa) return;
  const baseItems=CHECKLIST_BASE[ek]||[];

  // Restore any existing checklist state for this etapa
  const target=rIdx!=null?p.etapas[ek].retornoEtapas[rIdx]:p.etapas[ek];
  const saved=target.checklistState||{};

  const items=baseItems.map(it=>({
    id:it.id, text:it.text,
    checked: saved[it.id]||false
  }));

  clCtx={pid,ek,rIdx,items};

  // Set modal header
  document.getElementById('cl-etapa-dot').style.background=etapa.cor;
  document.getElementById('cl-etapa-nome').textContent=etapa.nome;
  document.getElementById('cl-prod-nome').textContent=p.nome;

  renderChecklistModal();
  document.getElementById('m-checklist').classList.add('open');
}

function renderChecklistModal(){
  if(!clCtx) return;
  const {items}=clCtx;
  const checked=items.filter(it=>it.checked).length;
  const total=items.length;
  const pct=total>0?Math.round(checked/total*100):100;

  // Progress
  document.getElementById('cl-prog-fill').style.width=pct+'%';
  document.getElementById('cl-prog-txt').textContent=total>0?(checked+'/'+total):('N/A');
  document.getElementById('cl-progress-wrap').style.display=total>0?'flex':'none';

  // Override note
  const overrideNote=document.getElementById('cl-override-note');
  overrideNote.style.display=(total>0&&checked<total)?'block':'none';

  // Footer note
  document.getElementById('cl-footer-note').textContent=
    total===0?'Nenhum item configurado para esta etapa. Configure os itens em Admin → Checklists.':
    checked===total?'✅ Todos os itens verificados! Pronto para concluir.':
    `${total-checked} item${(total-checked)!==1?'s':''} ainda não marcado${(total-checked)!==1?'s':''}.`;

  // Items
  const el=document.getElementById('cl-items');
  if(total===0){
    el.innerHTML='<div class="checklist-empty">Nenhum item configurado para esta etapa.<br><span style="font-size:11px">Adicione itens em <strong>Admin → Checklists por Etapa</strong>.</span></div>';
  } else {
    el.innerHTML=items.map((it,i)=>`
      <div class="checklist-item ${it.checked?'checked':''}" id="cl-it-${i}" onclick="toggleChecklistItem(${i})">
        <input type="checkbox" ${it.checked?'checked':''} onclick="event.stopPropagation();toggleChecklistItem(${i})">
        <span class="checklist-item-text">${it.text}</span>
      </div>`).join('');
  }
}

function toggleChecklistItem(idx){
  if(!clCtx) return;
  clCtx.items[idx].checked=!clCtx.items[idx].checked;
  renderChecklistModal();
}

function confirmarChecklist(){
  if(!clCtx) return;
  const {pid,ek,rIdx,items}=clCtx;
  const p=DATA.find(x=>x.id==pid); if(!p) return;

  // Save checklist state to the product
  const target=rIdx!=null?p.etapas[ek].retornoEtapas[rIdx]:p.etapas[ek];
  const state={};
  items.forEach(it=>state[it.id]=it.checked);
  target.checklistState=state;

  // Now actually set status to 'concluida'
  if(rIdx!=null){ p.etapas[ek].retornoEtapas[rIdx].status='concluida'; }
  else { p.etapas[ek].status='concluida'; }

  save();
  closeM('m-checklist');
  clCtx=null;
  refreshProd(p);
}

// ── GET CHECKLIST TAG HTML for an etapa box ──
function getChecklistTag(et, ek){
  loadChecklistBase();
  const baseItems=CHECKLIST_BASE[ek]||[];
  if(baseItems.length===0) return '';
  const saved=et.checklistState||{};
  const checkedN=baseItems.filter(it=>saved[it.id]).length;
  const total=baseItems.length;
  if(et.status!=='concluida') return ''; // only show on concluded
  const allOk=checkedN===total;
  return `<span class="cl-tag ${allOk?'':'incomplete'}" title="Checklist: ${checkedN}/${total} itens">✓ ${checkedN}/${total}</span>`;
}

// ══════════════════════════════════════════════
// ── PAINEL SEARCH ──
// ══════════════════════════════════════════════
let painelSearchTerm='';

function searchPainel(val){
  painelSearchTerm=val.toLowerCase().trim();
  const clear=document.getElementById('painel-search-clear');
  const count=document.getElementById('painel-search-count');
  if(clear) clear.style.display=painelSearchTerm?'block':'none';

  applyFilters(); // unified filter engine handles search + chips together

  // Count visible products
  if(count){
    if(painelSearchTerm){
      const visible=document.querySelectorAll('.produto-box:not([style*="display: none"]):not([style*="display:none"])').length;
      count.textContent=visible+' produto'+(visible!==1?'s':'')+ ' encontrado'+(visible!==1?'s':'');
      count.style.display='inline';
    } else {
      count.style.display='none';
    }
  }
}

function clearPainelSearch(){
  const input=document.getElementById('painel-search');
  if(input){ input.value=''; input.focus(); }
  searchPainel('');
}


// ══════════════════════════════════════════════
// ── DYNAMIC LISTS (Admin editável) ──
// ══════════════════════════════════════════════
const DEFAULT_LISTS = {
  marcas: ['CARE','GRANADO','PHEBO','PUIG','LELI'],
  linhas: ['ÁGUAS DE PHEBO','ANTISSÉPTICA','AROMÁTICOS','BARBEARIA','BEBÊ','CARE','FRUTAS','GLICERINA','ÍCONES PHEBO','LELI SCENTS','MEDICAMENTOS','ORIGENS','PERFUMARIA PHEBO','PET','PINK','TEMPEROS DA CULINÁRIA','TERRAPEUTICS','TRADICIONAL PHEBO','TRATAMENTO','VINTAGE'],
  tipos: ['ÁGUA DE LIMPEZA','BALM LABIAL','BALM PÓS-BARBA','BATOM','BLUSH','BOUNCE','BRUMA','CERA CABELOS','CERA UNHAS','CICACARE','COLÔNIA','COLÔNIA ROLL-ON','CONDICIONADOR','CORRETIVO','CREME MÃOS','CREME CAPILAR','CREME DE ASSADURAS','CREME PARA CUTÍCULAS','DEO COLÔNIA','DESODORANTE','DESODORANTE PARA PÉS','DIFUSOR','EAU DE TOILETTE','EAU DE TOILETTE ROLL-ON','ESFOLIANTE','ESMALTES','ESPUMA BARBEAR','EXTRATO DE PERFUME','GEL DE BANHO','GEL PARA PÉS E PERNAS CANSADAS','GEL PROTETOR DE CALOS E BOLHAS','GEL RELAXANTE ANTI-CANSAÇO','GLOSS','HAND SANITIZER','HIDRATANTE','ILUMINADOR','KIT','LEITE DE IMERSÃO','LENÇO UMEDECIDO','MANTEIGA','MÁSC. CÍLIOS','MÁSCARA CAPILAR','ÓLEO CAPILAR','ÓLEO CORPORAL','ÓLEO DE BARBA','ÓLEO FORTALECEDOR DE UNHAS','PERFUME','PERFUME ROLL-ON','POLVILHO ANTISSÉPTICO','PROTETOR SOLAR','REMOVEDOR DE ESMALTE','REPARADOR DE CALCANHARES','REPELENTE','SABONETE BARRA','SABONETE DE BARBEAR','SABONETE LÍQUIDO','SACHET ESCALDA PÉS','SAIS DE BANHO','SÉRUM','SHAMPOO','SILKY LIPS','SKINDROPS','SOS CUTICULAS PERFEITAS','SPRAY AMBIENTE','SPRAY CORPO E CABELO','SUPOSITÓRIO DE GLICERINA','TALCO','VELA'],
};

let LISTS = {};
async function fetchLists(){
  try{
    const { data, error } = await supabase.from('lists').select('*');
    if(error) throw error;
    if(data && data.length){
      LISTS = {};
      data.forEach(row=>{ LISTS[row.key] = row.items || []; });
    } else {
      LISTS = JSON.parse(JSON.stringify(DEFAULT_LISTS));
      await saveLists();
    }
  }catch(e){ console.error('Erro ao carregar lists do Supabase:', e); LISTS = JSON.parse(JSON.stringify(DEFAULT_LISTS)); }
}
// Compatibilidade: dados já carregados no bootstrap — chamadas espalhadas viram no-op.
function loadLists(){}
async function saveLists(){
  try{
    const rows = Object.keys(LISTS).map(k=>({ key:k, items:LISTS[k] }));
    const { error } = await supabase.from('lists').upsert(rows);
    if(error) throw error;
  }catch(e){ console.error('Erro ao salvar lists no Supabase:', e); }
}
function getList(key){ return LISTS[key]||DEFAULT_LISTS[key]||[]; }

function refreshModalSelects(){
  // Update all three selects in the new product modal dynamically
  const selMap={
    'np-marca': getList('marcas'),
    'np-linha': getList('linhas'),
    'np-tipo':  getList('tipos'),
  };
  Object.entries(selMap).forEach(([id,opts])=>{
    const sel=document.getElementById(id);
    if(!sel) return;
    const curr=sel.value;
    sel.innerHTML='<option value="">Selecione...</option>'+opts.map(o=>`<option ${o===curr?'selected':''}>${o}</option>`).join('');
  });
}

// Helper to build select options string from a list key
function buildOpts(key, selected=''){
  return '<option value="">—</option>'+getList(key).map(o=>`<option ${o===selected?'selected':''}>${o}</option>`).join('');
}

// ── LIST EDITOR ADMIN ──
let listEditorActive='marcas';
function renderListEditor(){
  const el=document.getElementById('list-editor-body');
  if(!el) return;
  loadLists();
  el.innerHTML=`
    <div class="list-editor-tabs">
      <button class="list-editor-tab ${listEditorActive==='marcas'?'active':''}" onclick="switchListTab('marcas')">Marcas</button>
      <button class="list-editor-tab ${listEditorActive==='linhas'?'active':''}" onclick="switchListTab('linhas')">Linhas</button>
      <button class="list-editor-tab ${listEditorActive==='tipos'?'active':''}" onclick="switchListTab('tipos')">Tipos de Produto</button>
    </div>
    <div id="list-editor-content"></div>`;
  renderListEditorContent();
}
function switchListTab(key){ listEditorActive=key; renderListEditor(); }
function renderListEditorContent(){
  const el=document.getElementById('list-editor-content');
  if(!el) return;
  const items=getList(listEditorActive);
  el.innerHTML=`
    <div style="display:flex;flex-direction:column;gap:5px;max-height:280px;overflow-y:auto;margin-bottom:10px">
      ${items.map((item,i)=>`
        <div class="list-opt-row">
          <span style="font-size:11px;color:var(--text3);font-family:var(--mono);min-width:24px">${i+1}.</span>
          <input type="text" value="${item.replace(/"/g,'&quot;')}" onchange="updateListItem(${i},this.value)" style="flex:1;font-size:12.5px;padding:5px 9px">
          <button onclick="removeListItem(${i})" title="Remover">✕</button>
        </div>`).join('')}
    </div>
    <div class="list-add-row">
      <input type="text" id="list-new-item" placeholder="Nova opção..." onkeydown="if(event.key==='Enter')addListItem()">
      <button class="btn sm primary" onclick="addListItem()">+ Adicionar</button>
    </div>`;
}
function addListItem(){
  const input=document.getElementById('list-new-item');
  const val=(input?.value||'').trim().toUpperCase();
  if(!val){input?.focus();return;}
  if(!LISTS[listEditorActive]) LISTS[listEditorActive]=[...DEFAULT_LISTS[listEditorActive]];
  if(LISTS[listEditorActive].includes(val)){alert('Esta opção já existe na lista.');return;}
  LISTS[listEditorActive].push(val);
  saveLists(); renderListEditor();
}
function removeListItem(idx){
  if(!confirm('Remover este item da lista?')) return;
  if(!LISTS[listEditorActive]) LISTS[listEditorActive]=[...DEFAULT_LISTS[listEditorActive]];
  LISTS[listEditorActive].splice(idx,1);
  saveLists(); renderListEditor();
}
function updateListItem(idx,val){
  if(!LISTS[listEditorActive]) LISTS[listEditorActive]=[...DEFAULT_LISTS[listEditorActive]];
  LISTS[listEditorActive][idx]=val.trim().toUpperCase();
  saveLists();
}
window.switchListTab=switchListTab;
window.addListItem=addListItem;
window.removeListItem=removeListItem;
window.updateListItem=updateListItem;

// ── Also update mkProdBox mini-box selects to use dynamic LISTS ──
function getListOptsForProd(key, selected){
  return '<option value="">—</option>'+getList(key).map(o=>`<option ${o===selected?'selected':''}>${o}</option>`).join('');
}

// ── KIT ITEMS in modal ──
let kitItemCount=0;
function toggleKitSection(isKit){
  const box=document.getElementById('np-kit-box');
  if(!box) return;
  box.classList.toggle('show',isKit);
  if(isKit && kitItemCount===0) addKitItem();
}
function addKitItem(){
  const container=document.getElementById('np-kit-items');
  if(!container) return;
  kitItemCount++;
  const row=document.createElement('div');
  row.className='kit-item-row';
  row.id='np-kit-row-'+kitItemCount;
  row.innerHTML=`
    <span>Produto ${kitItemCount}:</span>
    <input type="text" class="np-kit-item-input" placeholder="Ex: Sabonete Líquido Lavanda...">
    <button onclick="removeKitItem(${kitItemCount})" title="Remover">✕</button>`;
  container.appendChild(row);
  row.querySelector('input').focus();
}
function removeKitItem(n){
  const row=document.getElementById('np-kit-row-'+n);
  if(row) row.remove();
  // Renumber labels
  document.querySelectorAll('.kit-item-row').forEach((r,i)=>{
    const span=r.querySelector('span');
    if(span) span.textContent='Produto '+(i+1)+':';
  });
}
window.toggleKitSection=toggleKitSection;
window.addKitItem=addKitItem;
window.removeKitItem=removeKitItem;
// ══════════════════════════════════════════════
// ── AGENDA (Reuniões e Treinamentos) ──
// ══════════════════════════════════════════════
let AGENDA = { reuniao:[], treinamento:[] };
let openAgendaIds = new Set(); // ids of expanded agenda rows (per type), persists like product cards
let agendaCtx = null; // {type, editId|null, selectedAttendees:Set}

function toAgendaRow(item, tipo){
  return {
    id: item.id, tipo, titulo: item.titulo, data: item.data || null,
    horario: item.horario || '', notas: item.notas || '',
    attendees: item.attendees || [], concluida: !!item.concluida,
  };
}
function fromAgendaRow(r){
  return { id:r.id, titulo:r.titulo, data:r.data, horario:r.horario, notas:r.notas, attendees:r.attendees||[], concluida:!!r.concluida };
}

async function loadAgendaFromServer(){
  try{
    const { data, error } = await supabase.from('agenda_eventos').select('*');
    if(error) throw error;
    AGENDA = { reuniao:[], treinamento:[] };
    (data||[]).forEach(row=>{
      if(!AGENDA[row.tipo]) AGENDA[row.tipo]=[];
      AGENDA[row.tipo].push(fromAgendaRow(row));
    });
  }catch(e){ console.error('Erro ao carregar agenda do Supabase:', e); }
  if(!AGENDA.reuniao) AGENDA.reuniao=[];
  if(!AGENDA.treinamento) AGENDA.treinamento=[];
}
// Compatibilidade: dados já carregados no bootstrap — chamadas espalhadas viram no-op.
function loadAgenda(){
  if(!AGENDA.reuniao) AGENDA.reuniao=[];
  if(!AGENDA.treinamento) AGENDA.treinamento=[];
}
async function saveAgenda(){
  try{
    const rows=[...AGENDA.reuniao.map(i=>toAgendaRow(i,'reuniao')), ...AGENDA.treinamento.map(i=>toAgendaRow(i,'treinamento'))];
    const { error: delErr } = await supabase.from('agenda_eventos').delete().not('id','is',null);
    if(delErr) throw delErr;
    if(rows.length){
      const { error: insErr } = await supabase.from('agenda_eventos').insert(rows);
      if(insErr) throw insErr;
    }
  }catch(e){ console.error('Erro ao salvar agenda no Supabase:', e); }
}

function openAgendaModal(type, editId){
  loadAgenda();
  agendaCtx={type, editId: editId||null, selectedAttendees: new Set()};
  document.getElementById('agenda-modal-title').textContent = editId
    ? (type==='reuniao'?'✏️ Editar Reunião':'✏️ Editar Treinamento')
    : (type==='reuniao'?'📅 Nova Reunião':'🎓 Novo Treinamento');

  let item=null;
  if(editId){
    item=AGENDA[type].find(x=>x.id===editId);
    if(item) item.attendees.forEach(a=>agendaCtx.selectedAttendees.add(a));
  }

  document.getElementById('ag-titulo').value=item?item.titulo:'';
  document.getElementById('ag-data').value=item?item.data:'';
  document.getElementById('ag-horario').value=item?item.horario:'';
  document.getElementById('ag-notas').value=item?item.notas:'';

  renderAttendeePicker();
  document.getElementById('m-agenda').classList.add('open');
}

function renderAttendeePicker(){
  const el=document.getElementById('ag-attendees');
  if(!el) return;
  el.innerHTML=Object.keys(COLABS).map(k=>{
    const c=COLABS[k];
    const sel=agendaCtx.selectedAttendees.has(k);
    return `<button type="button" class="attendee-chip ${sel?'sel':''}" style="${sel?`background:${c.cor};border-color:${c.cor}`:''}" onclick="toggleAttendee('${k}')">${c.nome}</button>`;
  }).join('');
}

function toggleAttendee(k){
  if(!agendaCtx) return;
  if(agendaCtx.selectedAttendees.has(k)) agendaCtx.selectedAttendees.delete(k);
  else agendaCtx.selectedAttendees.add(k);
  renderAttendeePicker();
}

function saveAgendaItem(){
  if(!agendaCtx) return;
  const titulo=document.getElementById('ag-titulo').value.trim();
  const data=document.getElementById('ag-data').value;
  const horario=document.getElementById('ag-horario').value;
  const notas=document.getElementById('ag-notas').value.trim();
  if(!titulo){alert('Informe o título.');return;}
  if(!data){alert('Selecione a data.');return;}
  const attendees=[...agendaCtx.selectedAttendees];

  const {type,editId}=agendaCtx;
  if(editId){
    const item=AGENDA[type].find(x=>x.id===editId);
    if(item){ item.titulo=titulo; item.data=data; item.horario=horario; item.notas=notas; item.attendees=attendees; }
  } else {
    AGENDA[type].push({ id:'ag_'+Date.now()+'_'+Math.floor(Math.random()*1000), titulo, data, horario, notas, attendees });
  }
  saveAgenda();
  closeM('m-agenda');
  agendaCtx=null;
  renderAgenda(type);
}

function deleteAgendaItem(type, id){
  if(!confirm('Remover este item da agenda?')) return;
  AGENDA[type]=AGENDA[type].filter(x=>x.id!==id);
  saveAgenda();
  openAgendaIds.delete(id);
  renderAgenda(type);
}

function toggleAgendaItem(id){
  const body=document.getElementById('agbody-'+id);
  const ic=document.getElementById('agic-'+id);
  if(!body) return;
  const isOpen=body.classList.contains('open');
  if(isOpen){
    body.classList.remove('open');
    openAgendaIds.delete(id);
    if(ic) ic.classList.add('rot');
  } else {
    body.classList.add('open');
    openAgendaIds.add(id);
    if(ic) ic.classList.remove('rot');
  }
}

function fmtAgendaDate(d){
  if(!d) return '—';
  const dt=new Date(d+'T12:00:00');
  return dt.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric',weekday:'short'});
}

function renderAgenda(type){
  loadAgenda();
  const listEl=document.getElementById(type==='reuniao'?'reunioes-list':'treinamentos-list');
  const countEl=document.getElementById(type==='reuniao'?'reunioes-count':'treinamentos-count');
  if(!listEl) return;

  const items=[...AGENDA[type]].sort((a,b)=>{
    const da=(a.data||'')+(a.horario||'');
    const db=(b.data||'')+(b.horario||'');
    return da.localeCompare(db);
  });

  if(countEl) countEl.textContent=items.length+' '+(type==='reuniao'?(items.length!==1?'reuniões':'reunião'):(items.length!==1?'treinamentos':'treinamento'));

  if(items.length===0){
    listEl.innerHTML=`<div class="agenda-empty">Nenhum${type==='treinamento'?'':'a'} ${type==='reuniao'?'reunião':'treinamento'} cadastrad${type==='reuniao'?'a':'o'} ainda.<br>Clique em "+ Nov${type==='reuniao'?'a Reunião':'o Treinamento'}" para começar.</div>`;
    return;
  }

  listEl.innerHTML=items.map(item=>{
    const isOpen=openAgendaIds.has(item.id);
    const today=new Date().toISOString().split('T')[0];
    const isPast=item.data && item.data<today;
    return `<div class="agenda-item" style="${isPast?'opacity:.65':''}">
      <div class="agenda-item-header" onclick="toggleAgendaItem('${item.id}')">
        <div class="agenda-item-left">
          <span class="toggle-ic${isOpen?'':' rot'}" id="agic-${item.id}">▾</span>
          <span class="agenda-item-title">${item.titulo}</span>
        </div>
        <div class="agenda-item-meta">
          <span class="agenda-date-chip">${fmtAgendaDate(item.data)}</span>
          ${item.horario?`<span class="agenda-time-chip">🕐 ${item.horario}</span>`:''}
          <div class="agenda-people-avatars">
            ${(item.attendees||[]).slice(0,4).map(k=>{
              const c=COLABS[k]; if(!c) return '';
              return `<div class="agenda-avatar-mini" style="background:${c.cor}" title="${c.nome}">${c.ini}</div>`;
            }).join('')}
          </div>
          <div class="agenda-item-actions">
            <button class="btn sm" onclick="event.stopPropagation();openAgendaModal('${type}','${item.id}')" title="Editar">✏️</button>
            <button class="btn sm" style="color:var(--accent2);border-color:var(--accent2)" onclick="event.stopPropagation();deleteAgendaItem('${type}','${item.id}')" title="Remover">✕</button>
          </div>
        </div>
      </div>
      <div class="agenda-item-body${isOpen?' open':''}" id="agbody-${item.id}">
        <div class="agenda-detail-row">
          <div class="agenda-detail-block">
            <span class="agenda-detail-lbl">Data</span>
            <span class="agenda-detail-val">${fmtAgendaDate(item.data)}</span>
          </div>
          <div class="agenda-detail-block">
            <span class="agenda-detail-lbl">Horário</span>
            <span class="agenda-detail-val">${item.horario||'Não definido'}</span>
          </div>
          <div class="agenda-detail-block" style="flex:1;min-width:200px">
            <span class="agenda-detail-lbl">Responsáveis</span>
            <div class="agenda-people-full">
              ${(item.attendees||[]).length===0?'<span style="font-size:12px;color:var(--text3)">Nenhum analista vinculado</span>':
                item.attendees.map(k=>{
                  const c=COLABS[k]; if(!c) return '';
                  return `<span class="agenda-person-tag"><span class="agenda-avatar-mini" style="background:${c.cor};margin:0">${c.ini}</span>${c.nome}</span>`;
                }).join('')}
            </div>
          </div>
        </div>
        <div class="agenda-detail-block" style="margin-bottom:4px">
          <span class="agenda-detail-lbl">Notas</span>
        </div>
        <div class="agenda-notes-box">${item.notas?item.notas.replace(/</g,'&lt;'):'<span style="color:var(--text3)">Sem notas adicionadas.</span>'}</div>
      </div>
    </div>`;
  }).join('');
}

window.openAgendaModal=openAgendaModal;
window.toggleAttendee=toggleAttendee;
window.saveAgendaItem=saveAgendaItem;
window.deleteAgendaItem=deleteAgendaItem;
window.toggleAgendaItem=toggleAgendaItem;


// ══════════════════════════════════════════════
// ── PAINEL DE REUNIÕES ──
// ══════════════════════════════════════════════
let PR_DATA = [];        // array of meeting objects
let openPRIds = new Set(); // expanded card ids
let prEditId  = null;    // id being edited (null = new)
let prRespCount = 0;     // row counter for responsible selects

function toReuniaoRow(item){
  return {
    id: item.id, nome: item.nome, data: item.data || null,
    inicio: item.inicio || '', fim: item.fim || '', notas: item.notas || '',
    responsaveis: item.responsaveis || [], concluida: !!item.concluida,
    criado_em: item.criadoEm || new Date().toISOString(),
  };
}
function fromReuniaoRow(r){
  return { id:r.id, nome:r.nome, data:r.data, inicio:r.inicio, fim:r.fim, notas:r.notas, responsaveis:r.responsaveis||[], concluida:!!r.concluida, criadoEm:r.criado_em };
}

async function fetchPRData(){
  try{
    const { data, error } = await supabase.from('reunioes').select('*').order('criado_em');
    if(error) throw error;
    PR_DATA = (data||[]).map(fromReuniaoRow);
  }catch(e){ console.error('Erro ao carregar reuniões do Supabase:', e); PR_DATA = []; }
}
// Compatibilidade: dados já carregados no bootstrap — chamadas espalhadas viram no-op.
function loadPRData(){}
async function savePRData(){
  try{
    const { error: delErr } = await supabase.from('reunioes').delete().not('id','is',null);
    if(delErr) throw delErr;
    if(PR_DATA.length){
      const { error: insErr } = await supabase.from('reunioes').insert(PR_DATA.map(toReuniaoRow));
      if(insErr) throw insErr;
    }
  }catch(e){ console.error('Erro ao salvar reuniões no Supabase:', e); }
}

// ── Open modal ──
function openPainelReuniaoModal(editId){
  loadPRData();
  prEditId=editId||null;
  prRespCount=0;

  const titleEl=document.getElementById('pr-modal-title');
  titleEl.textContent = editId ? '✏️ Editar Reunião' : '📋 Nova Reunião';

  const item = editId ? PR_DATA.find(x=>x.id===editId) : null;

  document.getElementById('pr-nome').value  = item ? item.nome  : '';
  document.getElementById('pr-data').value  = item ? item.data  : '';
  document.getElementById('pr-inicio').value= item ? item.inicio: '';
  document.getElementById('pr-fim').value   = item ? item.fim   : '';
  document.getElementById('pr-notas').value = item ? item.notas : '';

  // Build responsible rows
  const respList = document.getElementById('pr-resp-list');
  respList.innerHTML = '';
  prRespCount = 0;
  const initResps = item && item.responsaveis.length > 0 ? item.responsaveis : [''];
  initResps.forEach(val => addPRRespRow(val));

  document.getElementById('m-painel-reuniao').classList.add('open');
  setTimeout(()=>document.getElementById('pr-nome').focus(), 80);
}

// ── Add a responsible selector row ──
function addPRRespRow(selectedVal){
  prRespCount++;
  const n = prRespCount;
  const respList = document.getElementById('pr-resp-list');
  const row = document.createElement('div');
  row.className = 'pr-resp-row';
  row.id = 'pr-resp-row-'+n;

  const opts = Object.keys(COLABS).map(k=>{
    const c = COLABS[k];
    return `<option value="${k}" ${selectedVal===k?'selected':''}>${c.nome}</option>`;
  }).join('');

  row.innerHTML = `
    <select id="pr-resp-sel-${n}">
      <option value="">Selecionar analista...</option>
      ${opts}
    </select>
    ${n > 1 ? `<button onclick="removePRRespRow(${n})" title="Remover">✕</button>` : ''}`;
  respList.appendChild(row);
}

function removePRRespRow(n){
  const row = document.getElementById('pr-resp-row-'+n);
  if(row) row.remove();
}

// ── Save ──
function savePainelReuniao(){
  const nome   = document.getElementById('pr-nome').value.trim();
  const data   = document.getElementById('pr-data').value;
  const inicio = document.getElementById('pr-inicio').value;
  const fim    = document.getElementById('pr-fim').value;
  const notas  = document.getElementById('pr-notas').value.trim();

  if(!nome){ alert('Informe o nome da reunião.'); document.getElementById('pr-nome').focus(); return; }
  if(!data){ alert('Selecione a data.'); return; }

  // Collect responsáveis
  const responsaveis = [];
  document.querySelectorAll('[id^="pr-resp-sel-"]').forEach(sel=>{
    if(sel.value) responsaveis.push(sel.value);
  });

  if(prEditId){
    const item = PR_DATA.find(x=>x.id===prEditId);
    if(item){ item.nome=nome; item.data=data; item.inicio=inicio; item.fim=fim; item.notas=notas; item.responsaveis=responsaveis; } // concluida field preserved
  } else {
    PR_DATA.push({
      id:'pr_'+Date.now()+'_'+Math.floor(Math.random()*9999),
      nome, data, inicio, fim, notas, responsaveis,
      concluida: false,
      criadoEm: new Date().toISOString()
    });
  }

  savePRData();
  closeM('m-painel-reuniao');
  prEditId = null;
  renderPainelReunioes();
}

// ── Delete ──
function deletePR(id){
  if(!confirm('Remover esta reunião?')) return;
  PR_DATA = PR_DATA.filter(x=>x.id!==id);
  savePRData();
  openPRIds.delete(id);
  renderPainelReunioes();
}

function concluirPR(id){
  const item = PR_DATA.find(x=>x.id===id);
  if(!item) return;
  item.concluida = !item.concluida;
  savePRData();
  renderPainelReunioes();
  if(document.getElementById('page-demandas')?.classList.contains('active')) renderPainelDemandas();
}
window.concluirPR = concluirPR;

// ── Toggle card ──
function togglePRCard(id){
  const body = document.getElementById('pr-body-'+id);
  const ic   = document.getElementById('pr-ic-'+id);
  if(!body) return;
  const isOpen = body.classList.contains('open');
  if(isOpen){
    body.classList.remove('open');
    openPRIds.delete(id);
    if(ic) ic.classList.add('rot');
  } else {
    body.classList.add('open');
    openPRIds.add(id);
    if(ic) ic.classList.remove('rot');
  }
}

// ── Render ──
function renderPainelReunioes(){
  loadPRData();
  const listEl    = document.getElementById('pr-list');
  const summaryEl = document.getElementById('pr-summary');
  if(!listEl) return;

  const today = new Date().toISOString().split('T')[0];

  // Split: ativas (today or future) vs concluídas (past)
  const sorted = [...PR_DATA].sort((a,b)=>{
    const da=(a.data||'')+(a.inicio||'');
    const db=(b.data||'')+(b.inicio||'');
    return da.localeCompare(db); // asc: próximas primeiro
  });
  const ativas     = sorted.filter(x=>!x.concluida&&(!x.data||x.data>=today));
  const concluidas = sorted.filter(x=>x.concluida||(x.data&&x.data<today)).reverse(); // most recent first

  if(summaryEl){
    const n=PR_DATA.length;
    summaryEl.textContent = n+' reuniã'+(n===1?'o':'ões')+' — '+ativas.length+' ativa'+(ativas.length!==1?'s':'')+', '+concluidas.length+' concluída'+(concluidas.length!==1?'s':'');
  }

  if(PR_DATA.length===0){
    listEl.innerHTML=`<div class="pr-empty"><div class="pr-empty-icon">📋</div>Nenhuma reunião cadastrada ainda.<br><span style="font-size:12px">Clique em <strong>"+ Nova Reunião"</strong> para começar.</span></div>`;
    return;
  }

  // ── Card builder ──
  function mkCard(item, concluida){
    const isOpen   = openPRIds.has(item.id);
    const isToday  = item.data===today;
    const respCols = (item.responsaveis||[]).filter(Boolean);

    let fmtDate='—';
    if(item.data){ const dt=new Date(item.data+'T12:00:00'); fmtDate=dt.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}); }

    let fmtTime='';
    if(item.inicio&&item.fim)      fmtTime=item.inicio+' – '+item.fim;
    else if(item.inicio)           fmtTime=item.inicio;
    else if(item.fim)              fmtTime='até '+item.fim;

    const avatarsHTML=respCols.slice(0,5).map(k=>{ const c=COLABS[k]; if(!c) return ''; return `<div class="pr-av" style="background:${c.cor}" title="${c.nome}">${c.ini}</div>`; }).join('');

    const respTagsHTML=respCols.length===0
      ?'<span style="font-size:12px;color:var(--text3)">Nenhum responsável</span>'
      :respCols.map(k=>{ const c=COLABS[k]; if(!c) return ''; return `<span class="pr-resp-tag"><span class="pr-av" style="background:${c.cor};margin:0;border:none;width:20px;height:20px;font-size:8px">${c.ini}</span>${c.nome}</span>`; }).join('');

    const todayBadge=isToday?'<span style="font-size:10px;font-weight:700;background:#d1fae5;color:#047857;padding:2px 8px;border-radius:10px">📅 Hoje</span>':'';
    const conclBadge=(concluida||item.concluida)&&!isToday?'<span style="font-size:10px;font-weight:700;background:var(--s-ok-bg);color:var(--s-ok);padding:2px 8px;border-radius:10px">✅ Realizada</span>':'';

    return `<div class="pr-card${concluida?'':''}" style="${concluida?'border-color:var(--s-ok-bg)':''}">
      <div class="pr-card-header" onclick="togglePRCard('${item.id}')">
        <span class="pr-toggle${isOpen?'':' rot'}" id="pr-ic-${item.id}">▾</span>
        <div class="pr-card-info">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="pr-card-nome">${item.nome}</span>
            ${todayBadge}${conclBadge}
          </div>
          <div class="pr-card-meta">
            <span class="pr-chip-date">${fmtDate}</span>
            ${fmtTime?`<span class="pr-chip-time">🕐 ${fmtTime}</span>`:''}
            <div class="pr-avatars">${avatarsHTML}</div>
          </div>
        </div>
        <div class="pr-card-actions">
          ${!item.concluida?`<button class="btn sm" style="color:var(--s-ok);border-color:var(--s-ok)" onclick="event.stopPropagation();concluirPR('${item.id}')" title="Marcar como concluída">✅</button>`:''}
          <button class="btn sm" onclick="event.stopPropagation();openPainelReuniaoModal('${item.id}')" title="Editar">✏️</button>
          <button class="btn sm" style="color:var(--accent2);border-color:var(--accent2)" onclick="event.stopPropagation();deletePR('${item.id}')" title="Remover">✕</button>
        </div>
      </div>
      <div class="pr-card-body${isOpen?' open':''}" id="pr-body-${item.id}">
        <div class="pr-body-inner">
          <div class="pr-field-block">
            <span class="pr-field-lbl">Responsáveis</span>
            <div class="pr-responsible-tags">${respTagsHTML}</div>
          </div>
          <div class="pr-field-block">
            <span class="pr-field-lbl">Data & Horário</span>
            <span class="pr-field-val">${fmtDate}</span>
            ${fmtTime?`<span class="pr-field-val" style="color:var(--accent);font-family:var(--mono)">${fmtTime}</span>`:''}
          </div>
        </div>
        <div class="pr-notes-area">
          <div class="pr-field-lbl" style="margin-bottom:7px">Anotações</div>
          <div class="pr-notes-content">${item.notas
            ?item.notas.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            :'<span style="color:var(--text3);font-style:italic">Sem anotações.</span>'}</div>
        </div>
      </div>
    </div>`;
  }

  // ── Render ──
  let html='';

  // Ativas (today or future)
  if(ativas.length===0){
    html+='<div class="empty-state" style="padding:20px;margin-bottom:8px">Nenhuma reunião agendada próxima.</div>';
  } else {
    html+=ativas.map(item=>mkCard(item,false)).join('');
  }

  // Concluídas — collapsible section (same pattern as product cards)
  if(concluidas.length>0){
    const secId='pr-concluidas-section';
    const bodyId='pr-concluidas-body';
    const icId='pr-concl-ic';
    const isSecOpen=openPRIds.has('__concluidas__');
    html+=`<div style="margin-top:18px;border-top:2px dashed var(--s-ok);border-radius:0 0 var(--radius) var(--radius);background:linear-gradient(to bottom,var(--s-ok-bg),transparent)" id="${secId}">
      <button class="concluidos-toggle" onclick="togglePRConcluidas()" style="width:100%;display:flex;align-items:center;gap:8px;padding:10px 16px;background:none;border:none;cursor:pointer;font-family:var(--font);font-size:13px;font-weight:700;color:var(--s-ok)">
        <span id="${icId}" style="font-size:11px;transition:transform .2s${isSecOpen?'':';transform:rotate(-90deg)'}">▾</span>
        ✅ Reuniões Realizadas
        <span style="background:var(--s-ok-bg);color:var(--s-ok);font-size:11px;font-weight:800;padding:2px 9px;border-radius:20px;font-family:var(--mono)">${concluidas.length}</span>
      </button>
      <div id="${bodyId}" style="display:${isSecOpen?'flex':'none'};flex-direction:column;gap:10px;padding:0 0 14px">
        ${concluidas.map(item=>mkCard(item,true)).join('')}
      </div>
    </div>`;
  }

  listEl.innerHTML=html;

  // ── TABELA CONSOLIDADA abaixo (fonte: Painel de Reuniões) ──
  // Concluídas sempre vão para o final da tabela.
  function buildPRRows(list, concluida){
    return list.map(item=>{
      const respTags=(item.responsaveis||[]).filter(Boolean).map(k=>{ const c=COLABS[k]; if(!c) return ''; return `<div class="pr-av" style="background:${c.cor};border:none;margin-left:2px" title="${c.nome}">${c.ini}</div>`; }).join('');
      let fmtD='—';
      if(item.data){ const dt=new Date(item.data+'T12:00:00'); fmtD=dt.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}); }
      const isToday2=item.data===today;
      let fmtTime='';
      if(item.inicio&&item.fim) fmtTime=item.inicio+' – '+item.fim;
      else if(item.inicio)      fmtTime=item.inicio;
      const statusLabel=concluida
        ?'<span style="font-size:10px;font-weight:700;background:var(--s-ok-bg);color:var(--s-ok);padding:2px 8px;border-radius:10px;white-space:nowrap">✅ Concluída</span>'
        :'<span style="font-size:10px;font-weight:700;background:var(--accent-light);color:var(--accent);padding:2px 8px;border-radius:10px;white-space:nowrap">🔄 Ativa</span>';
      return `<tr style="${concluida?'opacity:.65':''}">
        <td>${statusLabel}</td>
        <td><strong>${item.nome||'Reunião sem título'}</strong>${isToday2&&!concluida?' <span style="font-size:10px;font-weight:700;background:#d1fae5;color:#047857;padding:1px 6px;border-radius:8px">Hoje</span>':''}</td>
        <td style="font-family:var(--mono);font-size:12px;white-space:nowrap">${fmtD}</td>
        <td style="font-family:var(--mono);font-size:12px;white-space:nowrap">${fmtTime||'—'}</td>
        <td><div style="display:flex;gap:2px">${respTags||'<span style="color:var(--text3);font-size:12px">—</span>'}</div></td>
        <td style="font-size:12px;color:var(--text2);max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${(item.notas||'').replace(/"/g,'&quot;')}">${item.notas||'—'}</td>
      </tr>`;
    });
  }

  // ativas primeiro (ordem cronológica), concluídas por último
  const allRows=[...buildPRRows(ativas,false), ...buildPRRows(concluidas,true)];

  if(allRows.length>0){
    const tableSection=document.createElement('div');
    tableSection.style.cssText='margin-top:28px';
    tableSection.innerHTML=`
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:8px;border-bottom:1.5px solid var(--border)">
        <span style="font-size:14px;font-weight:700;color:var(--text)">📊 Compilado — Reuniões</span>
        <span style="font-size:12px;color:var(--text3)">${allRows.length} reuniã${allRows.length!==1?'ões':'o'}</span>
      </div>
      <div style="overflow-x:auto;border-radius:var(--radius);border:1.5px solid var(--border)">
        <table class="atable" style="margin:0;border:none;border-radius:0;min-width:700px">
          <thead><tr><th>Status</th><th>Nome</th><th>Data</th><th>Horário</th><th>Responsáveis</th><th>Notas</th></tr></thead>
          <tbody>${allRows.join('')}</tbody>
        </table>
      </div>`;
    listEl.appendChild(tableSection);
  }
}

function togglePRConcluidas(){
  const body=document.getElementById('pr-concluidas-body');
  const ic=document.getElementById('pr-concl-ic');
  if(!body) return;
  const isOpen=body.style.display!=='none';
  body.style.display=isOpen?'none':'flex';
  if(ic) ic.style.transform=isOpen?'rotate(-90deg)':'';
  if(isOpen) openPRIds.delete('__concluidas__');
  else openPRIds.add('__concluidas__');
}
window.togglePRConcluidas=togglePRConcluidas;

window.openPainelReuniaoModal = openPainelReuniaoModal;
window.addPRRespRow           = addPRRespRow;
window.removePRRespRow        = removePRRespRow;
window.savePainelReuniao      = savePainelReuniao;
window.deletePR               = deletePR;
window.togglePRCard           = togglePRCard;
// ══════════════════════════════════════════════
// ── PAINEL DE DEMANDAS (geral consolidado) ──
// ══════════════════════════════════════════════
let openPDIds   = new Set(); // expanded item ids
let pdFiltTipo  = 'all';
let pdFiltStatus= 'all';
let pdSearch    = '';
let pdConclOpen = false; // whether the concluídos section is open

// Build a unified flat list of ALL demands from every section
function buildAllDemandas(){
  loadPRData();
  loadAgenda();
  const today = new Date().toISOString().split('T')[0];
  const all = [];

  // ── 1. Produtos (from DATA) ──
  DATA.forEach(p=>{
    if(!p.colab||p.colab==='inbox') return; // skip inbox
    const col  = COLABS[p.colab]||{cor:'#8b92b4',ini:'?',nome:'?'};
    const ps   = getProdStatus(p);
    const conc = ps==='concluido';
    const curE = getCurrentEtapa(p);
    const pct  = Math.round(ETAPAS.filter(e=>p.etapas[e.key].status==='concluida').length/ETAPAS.length*100);
    const totalR= ETAPAS.reduce((s,e)=>s+(p.etapas[e.key].retrocessos||[]).length,0);

    // Date: earliest entrada across etapas
    let minDate='';
    ETAPAS.forEach(e=>{ if(p.etapas[e.key].entrada&&(!minDate||p.etapas[e.key].entrada<minDate)) minDate=p.etapas[e.key].entrada; });

    all.push({
      id:'prod_'+p.id,
      tipo:'produto',
      nome:p.nome,
      concluido:conc,
      data:minDate,
      responsaveis:[p.colab],
      responsaveisCols:[col],
      status:ps,
      origem:'Painel de Produtos',
      detalhe:{
        marca:p.marca||'—', linha:p.linha||'—', tipo:p.tipo||'—',
        etapaAtual:curE.nome, etapaCor:curE.cor,
        pct, totalR,
        prioridade:p.prioridade, agEsgotamento:p.agEsgotamento,
        isKit:p.isKit, kitItems:p.kitItems,
      },
      notas:'',
    });
  });

  // ── 2. Reuniões (Painel de Reuniões — PR_DATA) ──
  PR_DATA.forEach(item=>{
    const conc = item.data && item.data<today;
    const respCols = (item.responsaveis||[]).filter(Boolean).map(k=>COLABS[k]).filter(Boolean);
    all.push({
      id:'pr_'+item.id,
      tipo:'reuniao',
      nome:item.nome||'Reunião sem título',
      concluido:conc,
      data:item.data||'',
      responsaveis:item.responsaveis||[],
      responsaveisCols:respCols,
      status:conc?'concluido':'ativo',
      origem:'Painel de Reuniões',
      detalhe:{
        horarioInicio:item.inicio||'—',
        horarioFim:item.fim||'—',
      },
      notas:item.notas||'',
    });
  });

  // ── 3. Matérias-primas (Biodiversidade) ──
  loadMP();
  MP_DATA.forEach(item=>{
    const conc=item.status==='concluido';
    all.push({
      id:'mp_'+item.id,
      tipo:'materiaprima',
      nome:item.nome||'Matéria-prima sem nome',
      concluido:conc,
      data:item.criadoEm?item.criadoEm.split('T')[0]:'',
      responsaveis:[],
      responsaveisCols:[],
      status:item.status||'backlog',
      origem:'Biodiversidade — Matéria-prima',
      detalhe:{ged:item.ged||'—',pendencia:item.pendencia||'',status:item.status},
      notas:item.pendencia||'',
    });
  });

  return all;
}

function fmtPDDate(d){
  if(!d) return '—';
  const dt=new Date(d+'T12:00:00');
  return dt.toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric',weekday:'short'});
}

function renderPainelDemandas(){
  const listEl = document.getElementById('pd-list');
  const countEl= document.getElementById('pd-count');
  const sumEl  = document.getElementById('pd-summary-row');
  if(!listEl) return;

  const all = buildAllDemandas();

  // Summary cards
  const totProd   = all.filter(x=>x.tipo==='produto').length;
  const totReun   = all.filter(x=>x.tipo==='reuniao').length;
  const totConc   = all.filter(x=>x.concluido).length;
  const totAtivo  = all.filter(x=>!x.concluido).length;

  if(sumEl) sumEl.innerHTML=`
    <div class="pd-sum-card"><div class="pd-sum-val">${all.length}</div><div class="pd-sum-lbl">Total</div></div>
    <div class="pd-sum-card" style="border-color:var(--accent)"><div class="pd-sum-val" style="color:var(--accent)">${totAtivo}</div><div class="pd-sum-lbl">Em aberto</div></div>
    <div class="pd-sum-card" style="border-color:var(--s-ok)"><div class="pd-sum-val" style="color:var(--s-ok)">${totConc}</div><div class="pd-sum-lbl">Concluídas</div></div>
    <div class="pd-sum-card"><div class="pd-sum-val">${totProd}</div><div class="pd-sum-lbl">Produtos</div></div>
    <div class="pd-sum-card"><div class="pd-sum-val">${totReun}</div><div class="pd-sum-lbl">Reuniões</div></div>
    <div class="pd-sum-card"><div class="pd-sum-val">${all.filter(x=>x.tipo==='materiaprima').length}</div><div class="pd-sum-lbl">Matérias-primas</div></div>`;

  // Filter
  const term = pdSearch.toLowerCase().trim();
  function matchItem(x){
    if(pdFiltTipo!=='all'&&x.tipo!==pdFiltTipo) return false;
    if(pdFiltStatus==='ativo'&&x.concluido) return false;
    if(pdFiltStatus==='concluido'&&!x.concluido) return false;
    if(term&&!x.nome.toLowerCase().includes(term)&&!x.origem.toLowerCase().includes(term)) return false;
    return true;
  }

  const filtered = all.filter(matchItem);

  if(countEl) countEl.textContent = filtered.length + ' demanda'+(filtered.length!==1?'s':'');

  if(filtered.length===0){
    listEl.innerHTML=`<div class="pd-empty"><div class="pd-empty-icon">🗂️</div>Nenhuma demanda encontrada.<br><span style="font-size:12px">Adicione produtos, reuniões ou treinamentos nas seções específicas.</span></div>`;
    return;
  }

  function mkTypeBadge(tipo){
    const map={
      produto:`<span class="pd-type-badge" style="background:var(--accent-light);color:var(--accent)">📦 Produto</span>`,
      reuniao:`<span class="pd-type-badge" style="background:#ede9fe;color:#7c3aed">📋 Reunião</span>`,
      materiaprima:`<span class="pd-type-badge" style="background:#d1fae5;color:#047857">🧪 Matéria-prima</span>`,
    };
    return map[tipo]||`<span class="pd-type-badge" style="background:var(--surface2);color:var(--text3)">${tipo}</span>`;
  }

  function mkStatusTag(x){
    if(x.concluido) return `<span class="tag tag-ok">✅ Concluída</span>`;
    const map={
      andamento:`<span class="tag tag-and">🔄 Em andamento</span>`,
      aguardando:`<span class="tag tag-wait">⏳ Ag. Retorno</span>`,
      backlog:`<span class="tag tag-back">📦 Backlog</span>`,
      ativo:`<span class="tag tag-and" style="background:var(--s-and-bg);color:#b45309">🔄 Em aberto</span>`,
    };
    return map[x.status]||`<span class="tag tag-pend">${x.status}</span>`;
  }

  function mkCard(x){
    const isOpen = openPDIds.has(x.id);
    const d = x.detalhe||{};

    // Responsáveis avatars
    const avsHTML = x.responsaveisCols.slice(0,5).map(c=>`<div class="pd-av" style="background:${c.cor}" title="${c.nome}">${c.ini}</div>`).join('');

    // Body content per type
    let bodyHTML='';
    if(x.tipo==='produto'){
      bodyHTML=`
        <div class="pd-detail-grid">
          <div class="pd-detail-block"><span class="pd-detail-lbl">Analista</span>
            <span class="pd-detail-val">${x.responsaveisCols.map(c=>`<span style="display:inline-flex;align-items:center;gap:4px"><span class="pd-av" style="background:${c.cor};width:18px;height:18px;font-size:8px">${c.ini}</span>${c.nome}</span>`).join(', ')}</span>
          </div>
          <div class="pd-detail-block"><span class="pd-detail-lbl">Marca</span><span class="pd-detail-val">${d.marca||'—'}</span></div>
          <div class="pd-detail-block"><span class="pd-detail-lbl">Linha</span><span class="pd-detail-val">${d.linha||'—'}</span></div>
          <div class="pd-detail-block"><span class="pd-detail-lbl">Tipo</span><span class="pd-detail-val">${d.tipo||'—'}</span></div>
          <div class="pd-detail-block"><span class="pd-detail-lbl">Etapa Atual</span>
            <span class="pd-detail-val" style="color:${d.etapaCor}">● ${d.etapaAtual}</span>
          </div>
          <div class="pd-detail-block"><span class="pd-detail-lbl">Progresso</span>
            <div style="display:flex;align-items:center;gap:7px;margin-top:2px">
              <div style="flex:1;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden">
                <div style="height:100%;width:${d.pct}%;background:var(--accent);border-radius:3px"></div>
              </div>
              <span style="font-family:var(--mono);font-size:11px">${d.pct}%</span>
            </div>
          </div>
          <div class="pd-detail-block"><span class="pd-detail-lbl">Retrocessos</span>
            <span class="pd-detail-val" style="color:${d.totalR>0?'var(--s-retro)':'var(--text3)'}">${d.totalR>0?d.totalR:'Nenhum'}</span>
          </div>
          <div class="pd-detail-block"><span class="pd-detail-lbl">Flags</span>
            <span class="pd-detail-val">${[d.prioridade?'⭐ Prioridade':'',d.agEsgotamento?'⏳ Ag. Esgotamento':'',d.isKit?'📦 Kit':''].filter(Boolean).join(' · ')||'—'}</span>
          </div>
        </div>`;
    } else if(x.tipo==='materiaprima'){
      bodyHTML=`
        <div class="pd-detail-grid">
          <div class="pd-detail-block"><span class="pd-detail-lbl">GED</span><span class="pd-detail-val" style="font-family:var(--mono)">${d.ged||'—'}</span></div>
          <div class="pd-detail-block"><span class="pd-detail-lbl">Status</span><span class="pd-detail-val">${MP_STATUS_LABELS[d.status]||d.status}</span></div>
          ${d.pendencia?`<div class="pd-detail-block" style="grid-column:1/-1"><span class="pd-detail-lbl">Pendência</span><div style="font-size:12.5px;color:var(--s-retro);background:var(--s-retro-bg);border:1px solid #f8c5b0;border-radius:6px;padding:8px 11px;margin-top:2px">${d.pendencia}</div></div>`:''}
        </div>`;
    } else if(x.tipo==='reuniao'){
      bodyHTML=`
        <div class="pd-detail-grid">
          <div class="pd-detail-block"><span class="pd-detail-lbl">Responsáveis</span>
            <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:2px">
              ${x.responsaveisCols.length===0
                ?'<span style="color:var(--text3);font-size:12px">—</span>'
                :x.responsaveisCols.map(c=>`<span style="display:inline-flex;align-items:center;gap:4px;background:var(--surface2);padding:2px 8px 2px 3px;border-radius:12px;font-size:12px;font-weight:600"><span class="pd-av" style="background:${c.cor};width:18px;height:18px;font-size:8px">${c.ini}</span>${c.nome}</span>`).join('')}
            </div>
          </div>
          <div class="pd-detail-block"><span class="pd-detail-lbl">Data</span><span class="pd-detail-val">${fmtPDDate(x.data)}</span></div>
          <div class="pd-detail-block"><span class="pd-detail-lbl">Horário</span>
            <span class="pd-detail-val" style="font-family:var(--mono)">
              ${d.horarioInicio&&d.horarioInicio!=='—'?d.horarioInicio:'—'}${d.horarioFim&&d.horarioFim!=='—'?' – '+d.horarioFim:''}
            </span>
          </div>
        </div>
        ${x.notas?`<div class="pd-detail-lbl" style="margin-bottom:6px">Anotações</div><div class="pd-notes">${x.notas.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>`:''}`;
    }

    return `<div class="pd-item${x.concluido?' concluido':''}">
      <div class="pd-item-header" onclick="togglePDItem('${x.id}')">
        <span class="pd-toggle${isOpen?'':' rot'}" id="pd-ic-${x.id}">▾</span>
        <div class="pd-item-left">
          <div class="pd-item-title">${x.nome}</div>
          <div class="pd-item-sub">
            ${mkTypeBadge(x.tipo)}
            <span class="pd-source-badge">${x.origem}</span>
            ${x.data?`<span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${fmtPDDate(x.data)}</span>`:''}
          </div>
        </div>
        <div class="pd-item-meta">
          <div style="display:flex">${avsHTML}</div>
          ${mkStatusTag(x)}
        </div>
      </div>
      <div class="pd-item-body${isOpen?' open':''}" id="pd-body-${x.id}">
        ${bodyHTML}
      </div>
    </div>`;
  }

  // ── Group by analista ──
  // Items with no responsável go into a special "Sem analista" bucket
  const groups = {}; // key: colabKey or '__none__' -> {ativas:[], concluidas:[]}
  Object.keys(COLABS).forEach(k=>{ groups[k]={ativas:[],concluidas:[]}; });
  groups['__none__']={ativas:[],concluidas:[]};

  filtered.forEach(x=>{
    const keys = (x.responsaveis&&x.responsaveis.length>0) ? x.responsaveis.filter(k=>COLABS[k]) : [];
    if(keys.length===0){
      (x.concluido?groups['__none__'].concluidas:groups['__none__'].ativas).push(x);
    } else {
      keys.forEach(k=>{
        if(!groups[k]) groups[k]={ativas:[],concluidas:[]};
        (x.concluido?groups[k].concluidas:groups[k].ativas).push(x);
      });
    }
  });

  // Sort each group's lists by date desc
  Object.values(groups).forEach(g=>{
    g.ativas.sort((a,b)=>(b.data||'').localeCompare(a.data||''));
    g.concluidas.sort((a,b)=>(b.data||'').localeCompare(a.data||''));
  });

  // ── Build HTML per analyst group ──
  let html='';
  const orderedKeys=[...Object.keys(COLABS),'__none__'];

  orderedKeys.forEach(k=>{
    const g=groups[k];
    const totalInGroup=g.ativas.length+g.concluidas.length;
    if(totalInGroup===0) return; // skip empty analysts

    const isNone = k==='__none__';
    const c = isNone ? {cor:'#8b92b4',ini:'?',nome:'Sem analista vinculado'} : COLABS[k];
    const groupOpen = pdGroupOpen.has(k) || pdGroupOpen.size===0; // default expanded if nothing set yet

    html+=`<div class="pd-analyst-group">
      <div class="pd-analyst-header" onclick="togglePDGroup('${k}')" style="border-left:4px solid ${c.cor}">
        <span class="pd-toggle${groupOpen?'':' rot'}" id="pd-grp-ic-${k}">▾</span>
        <div class="pd-av" style="background:${c.cor};width:28px;height:28px;font-size:11px">${c.ini}</div>
        <span class="pd-analyst-name">${c.nome}</span>
        <span class="pd-analyst-count">${g.ativas.length} ativa${g.ativas.length!==1?'s':''}</span>
        ${g.concluidas.length>0?`<span class="pd-analyst-count" style="color:var(--s-ok)">${g.concluidas.length} concluída${g.concluidas.length!==1?'s':''}</span>`:''}
      </div>
      <div class="pd-analyst-body" id="pd-grp-body-${k}" style="display:${groupOpen?'block':'none'}">
        ${g.ativas.length===0
          ? '<div class="empty-state" style="padding:14px">Nenhuma demanda ativa para esta analista.</div>'
          : g.ativas.map(x=>mkCard(x)).join('')}
        ${g.concluidas.length>0?`
        <div class="pd-concl-section">
          <button class="pd-concl-toggle" onclick="togglePDConcluidasGroup('${k}')">
            <span id="pd-concl-ic-${k}" style="font-size:11px;transition:transform .2s${pdConclGroupOpen.has(k)?'':';transform:rotate(-90deg)'}">▾</span>
            ✅ Concluídas
            <span style="background:var(--s-ok-bg);color:var(--s-ok);font-size:11px;font-weight:800;padding:2px 9px;border-radius:20px;font-family:var(--mono)">${g.concluidas.length}</span>
          </button>
          <div class="pd-concl-body" id="pd-concl-body-${k}" style="display:${pdConclGroupOpen.has(k)?'block':'none'}">
            ${g.concluidas.map(x=>mkCard(x)).join('')}
          </div>
        </div>`:''}
      </div>
    </div>`;
  });

  listEl.innerHTML = html || `<div class="pd-empty"><div class="pd-empty-icon">🗂️</div>Nenhuma demanda encontrada.</div>`;
}

let pdGroupOpen = new Set();       // which analyst groups are expanded (empty set = all expanded by default)
let pdConclGroupOpen = new Set();  // which analyst "concluídas" sub-sections are expanded

function togglePDGroup(k){
  const body=document.getElementById('pd-grp-body-'+k);
  const ic=document.getElementById('pd-grp-ic-'+k);
  if(!body) return;
  const isOpen=body.style.display!=='none';
  // Lazily initialize pdGroupOpen with all keys if it was empty (meaning "all open")
  if(pdGroupOpen.size===0){
    [...Object.keys(COLABS),'__none__'].forEach(key=>pdGroupOpen.add(key));
  }
  if(isOpen){ body.style.display='none'; pdGroupOpen.delete(k); if(ic) ic.classList.add('rot'); }
  else      { body.style.display='block'; pdGroupOpen.add(k);   if(ic) ic.classList.remove('rot'); }
}

function togglePDConcluidasGroup(k){
  const body=document.getElementById('pd-concl-body-'+k);
  const ic=document.getElementById('pd-concl-ic-'+k);
  if(!body) return;
  const isOpen=body.style.display!=='none';
  body.style.display=isOpen?'none':'block';
  if(ic) ic.style.transform=isOpen?'rotate(-90deg)':'';
  if(isOpen) pdConclGroupOpen.delete(k); else pdConclGroupOpen.add(k);
}
window.togglePDGroup=togglePDGroup;
window.togglePDConcluidasGroup=togglePDConcluidasGroup;

function togglePDItem(id){
  const body=document.getElementById('pd-body-'+id);
  const ic=document.getElementById('pd-ic-'+id);
  if(!body) return;
  const isOpen=body.classList.contains('open');
  if(isOpen){ body.classList.remove('open'); openPDIds.delete(id); if(ic) ic.classList.add('rot'); }
  else       { body.classList.add('open');    openPDIds.add(id);    if(ic) ic.classList.remove('rot'); }
}

let pdFiltTipoGroup  = null;
let pdFiltStatusGroup= null;
function setPDFilter(group, val, btn){
  if(group==='tipo'){
    pdFiltTipo=val;
    document.querySelectorAll('#pd-filters .chip').forEach(c=>{
      // only reset chips in the same group (before the divider)
    });
    // Reset all tipo chips
    const allChips=[...document.querySelectorAll('#pd-filters .chip')];
    const divider=document.querySelector('#pd-filters [style*="width:1px"]');
    const divIdx=allChips.indexOf(divider); // won't find it, filter only chips
    allChips.slice(0,3).forEach(c=>c.classList.remove('active'));
    btn.classList.add('active');
  } else {
    pdFiltStatus=val;
    const allChips=[...document.querySelectorAll('#pd-filters .chip')];
    allChips.slice(3).forEach(c=>c.classList.remove('active'));
    btn.classList.add('active');
  }
  renderPainelDemandas();
}

function filterPD(){
  pdSearch=document.getElementById('pd-search')?.value||'';
  renderPainelDemandas();
}

window.togglePDItem=togglePDItem;
window.setPDFilter=setPDFilter;
window.filterPD=filterPD;


// ══════════════════════════════════════════════
// ── MATÉRIA-PRIMA (dentro do Painel Biodiversidade) ──
// ══════════════════════════════════════════════
let MP_DATA = [];
let openMPIds = new Set();
let mpEditId = null;
let mpSearchTerm = '';
let openMPConclOpen = false;

const MP_STATUS_OPTS=['backlog','andamento','incompleto','concluido'];
const MP_STATUS_LABELS={backlog:'📦 Backlog',andamento:'🔄 Em andamento',incompleto:'⚠️ Incompleto',concluido:'✅ Concluído'};
const MP_STATUS_COLORS={backlog:'var(--s-back)',andamento:'#b45309',incompleto:'var(--accent2)',concluido:'var(--s-ok)'};
const MP_STATUS_BG={backlog:'var(--s-back-bg)',andamento:'var(--s-and-bg)',incompleto:'var(--s-retro-bg)',concluido:'var(--s-ok-bg)'};

function toMPRow(item){
  return { id:item.id, nome:item.nome, ged:item.ged||'', status:item.status||'backlog', pendencia:item.pendencia||'', criado_em:item.criadoEm||new Date().toISOString() };
}
function fromMPRow(r){
  return { id:r.id, nome:r.nome, ged:r.ged, status:r.status, pendencia:r.pendencia, criadoEm:r.criado_em };
}
async function fetchMP(){
  try{
    const { data, error } = await supabase.from('materia_prima').select('*').order('criado_em');
    if(error) throw error;
    MP_DATA = (data||[]).map(fromMPRow);
  }catch(e){ console.error('Erro ao carregar matéria-prima do Supabase:', e); MP_DATA = []; }
}
// Compatibilidade: dados já carregados no bootstrap — chamadas espalhadas viram no-op.
function loadMP(){}
async function saveMP_store(){
  try{
    const { error: delErr } = await supabase.from('materia_prima').delete().not('id','is',null);
    if(delErr) throw delErr;
    if(MP_DATA.length){
      const { error: insErr } = await supabase.from('materia_prima').insert(MP_DATA.map(toMPRow));
      if(insErr) throw insErr;
    }
  }catch(e){ console.error('Erro ao salvar matéria-prima no Supabase:', e); }
}

function openMPModal(editId){
  loadMP();
  mpEditId=editId||null;
  const item=editId?MP_DATA.find(x=>x.id===editId):null;
  document.getElementById('mp-modal-title').textContent=editId?'✏️ Editar Matéria-Prima':'🧪 Nova Matéria-Prima';
  document.getElementById('mp-nome').value=item?item.nome:'';
  document.getElementById('mp-ged').value=item?(item.ged||''):'';
  document.getElementById('mp-status').value=item?item.status:'backlog';
  document.getElementById('mp-pendencia').value=item?(item.pendencia||''):'';
  toggleMPPendencia(item?item.status:'backlog');
  document.getElementById('m-mp').classList.add('open');
  setTimeout(()=>document.getElementById('mp-nome').focus(),80);
}

function toggleMPPendencia(val){
  const g=document.getElementById('mp-pendencia-group');
  if(g) g.style.display=val==='incompleto'?'block':'none';
}

function saveMP(){
  const nome=document.getElementById('mp-nome').value.trim();
  const ged=document.getElementById('mp-ged').value.trim();
  const status=document.getElementById('mp-status').value;
  const pendencia=document.getElementById('mp-pendencia').value.trim();
  if(!nome){alert('Informe o nome da matéria-prima.');document.getElementById('mp-nome').focus();return;}
  if(mpEditId){
    const item=MP_DATA.find(x=>x.id===mpEditId);
    if(item){item.nome=nome;item.ged=ged;item.status=status;item.pendencia=status==='incompleto'?pendencia:'';}
  } else {
    MP_DATA.push({id:'mp_'+Date.now()+'_'+Math.floor(Math.random()*9999),nome,ged,status,pendencia:status==='incompleto'?pendencia:'',criadoEm:new Date().toISOString()});
  }
  saveMP_store();
  closeM('m-mp');
  mpEditId=null;
  renderMP();
  if(document.getElementById('page-demandas')?.classList.contains('active')) renderPainelDemandas();
}

function deleteMP(id){
  if(!confirm('Remover esta matéria-prima?')) return;
  MP_DATA=MP_DATA.filter(x=>x.id!==id);
  saveMP_store();
  openMPIds.delete(id);
  renderMP();
  if(document.getElementById('page-demandas')?.classList.contains('active')) renderPainelDemandas();
}

// Mudar status diretamente pelo select do card — quando vira "concluido",
// o item some da lista ativa e cai automaticamente na seção "Concluídas" no próximo render.
function updateMPStatus(id,val){
  const item=MP_DATA.find(x=>x.id===id);
  if(!item) return;
  if(val==='incompleto'){
    const pendencia=prompt('Descreva a pendência:',item.pendencia||'');
    if(pendencia===null) return;
    item.pendencia=pendencia;
  } else if(val!=='incompleto'){
    item.pendencia='';
  }
  item.status=val;
  saveMP_store();
  renderMP();
  if(document.getElementById('page-demandas')?.classList.contains('active')) renderPainelDemandas();
}

function toggleMPCard(id){
  const body=document.getElementById('mp-body-'+id);
  const ic=document.getElementById('mp-ic-'+id);
  if(!body) return;
  const isOpen=body.classList.contains('open');
  if(isOpen){ body.classList.remove('open'); openMPIds.delete(id); if(ic) ic.classList.add('rot'); }
  else{ body.classList.add('open'); openMPIds.add(id); if(ic) ic.classList.remove('rot'); }
}

function searchMP(val){
  mpSearchTerm=(val||'').toLowerCase().trim();
  const clear=document.getElementById('mp-search-clear');
  const cnt=document.getElementById('mp-count');
  if(clear) clear.style.display=mpSearchTerm?'block':'none';
  renderMP();
  if(cnt){
    const n=MP_DATA.filter(x=>!mpSearchTerm||x.nome.toLowerCase().includes(mpSearchTerm)||(x.ged||'').toLowerCase().includes(mpSearchTerm)).length;
    cnt.textContent=n+' encontrada'+(n!==1?'s':'');
    cnt.style.display=mpSearchTerm?'inline':'none';
  }
}

function clearMPSearch(){
  const inp=document.getElementById('mp-search');
  if(inp){ inp.value=''; inp.focus(); }
  mpSearchTerm='';
  const clear=document.getElementById('mp-search-clear');
  const cnt=document.getElementById('mp-count');
  if(clear) clear.style.display='none';
  if(cnt) cnt.style.display='none';
  renderMP();
}

function toggleMPConcluidas(){
  const body=document.getElementById('mp-concl-body');
  const ic=document.getElementById('mp-concl-ic');
  if(!body) return;
  openMPConclOpen=!openMPConclOpen;
  body.style.display=openMPConclOpen?'block':'none';
  if(ic) ic.style.transform=openMPConclOpen?'':'rotate(-90deg)';
}

function renderMP(){
  loadMP();
  const listEl=document.getElementById('mp-list');
  if(!listEl) return;
  const term=mpSearchTerm;
  const filtered=MP_DATA.filter(x=>!term||x.nome.toLowerCase().includes(term)||(x.ged||'').toLowerCase().includes(term));
  const ativas=filtered.filter(x=>x.status!=='concluido');
  const concluidas=filtered.filter(x=>x.status==='concluido');

  function mkMPCard(item){
    const isOpen=openMPIds.has(item.id);
    return `<div class="pd-item${item.status==='concluido'?' concluido':''}" style="margin-bottom:8px">
      <div class="pd-item-header" onclick="toggleMPCard('${item.id}')">
        <span class="pd-toggle${isOpen?'':' rot'}" id="mp-ic-${item.id}">▾</span>
        <div class="pd-item-left">
          <div class="pd-item-title">${item.nome}</div>
          <div class="pd-item-sub">
            ${item.ged?`<span class="pd-source-badge" style="font-family:var(--mono)">GED: ${item.ged}</span>`:''}
            <span style="font-size:10.5px;font-weight:700;padding:2px 9px;border-radius:10px;background:${MP_STATUS_BG[item.status]};color:${MP_STATUS_COLORS[item.status]}">${MP_STATUS_LABELS[item.status]}</span>
            ${item.status==='incompleto'&&item.pendencia?`<span style="font-size:11px;color:var(--accent2)">— ${item.pendencia}</span>`:''}
          </div>
        </div>
        <div class="pd-item-meta">
          <button class="btn sm" onclick="event.stopPropagation();openMPModal('${item.id}')" title="Editar">✏️</button>
          <button class="btn sm" style="color:var(--accent2);border-color:var(--accent2)" onclick="event.stopPropagation();deleteMP('${item.id}')" title="Remover">✕</button>
        </div>
      </div>
      <div class="pd-item-body${isOpen?' open':''}" id="mp-body-${item.id}">
        <div class="pd-detail-grid">
          <div class="pd-detail-block"><span class="pd-detail-lbl">Nome</span><span class="pd-detail-val">${item.nome}</span></div>
          <div class="pd-detail-block"><span class="pd-detail-lbl">Código GED</span><span class="pd-detail-val" style="font-family:var(--mono)">${item.ged||'—'}</span></div>
          <div class="pd-detail-block"><span class="pd-detail-lbl">Status</span>
            <select onchange="updateMPStatus('${item.id}',this.value)" style="font-size:12px;padding:4px 7px;border:1.5px solid var(--border2);border-radius:5px;font-family:var(--font)" onclick="event.stopPropagation()">
              ${MP_STATUS_OPTS.map(s=>`<option value="${s}" ${item.status===s?'selected':''}>${MP_STATUS_LABELS[s]}</option>`).join('')}
            </select>
          </div>
          ${item.status==='incompleto'?`<div class="pd-detail-block"><span class="pd-detail-lbl">Pendência</span><span class="pd-detail-val" style="color:var(--accent2)">${item.pendencia||'—'}</span></div>`:''}
        </div>
      </div>
    </div>`;
  }

  if(filtered.length===0){
    listEl.innerHTML=`<div class="pd-empty"><div class="pd-empty-icon">🧪</div>${term?'Nenhuma matéria-prima encontrada.':'Nenhuma matéria-prima cadastrada. Clique em "+ Nova Matéria-Prima" para começar.'}</div>`;
    return;
  }

  let html = ativas.length===0
    ? '<div class="empty-state" style="padding:16px">Nenhuma matéria-prima ativa.</div>'
    : ativas.map(mkMPCard).join('');

  if(concluidas.length>0){
    html+=`<div class="pd-concl-section" style="margin-top:14px">
      <button class="pd-concl-toggle" onclick="toggleMPConcluidas()">
        <span id="mp-concl-ic" style="font-size:11px;transition:transform .2s${openMPConclOpen?'':';transform:rotate(-90deg)'}">▾</span>
        ✅ Concluídas
        <span style="background:var(--s-ok-bg);color:var(--s-ok);font-size:11px;font-weight:800;padding:2px 9px;border-radius:20px;font-family:var(--mono)">${concluidas.length}</span>
      </button>
      <div id="mp-concl-body" style="display:${openMPConclOpen?'block':'none'}">
        ${concluidas.map(mkMPCard).join('')}
      </div>
    </div>`;
  }

  listEl.innerHTML=html;
}

window.openMPModal=openMPModal;
window.toggleMPPendencia=toggleMPPendencia;
window.saveMP=saveMP;
window.deleteMP=deleteMP;
window.updateMPStatus=updateMPStatus;
window.toggleMPCard=toggleMPCard;
window.searchMP=searchMP;
window.clearMPSearch=clearMPSearch;
window.toggleMPConcluidas=toggleMPConcluidas;

// ══════════════════════════════════════════════
// ── ALERTA DE REUNIÃO (15 min antes) ──
// ══════════════════════════════════════════════
let _alertedMeetings = new Set(); // ids já alertados nesta sessão

function checkMeetingAlerts(){
  loadPRData();
  const now   = new Date();
  const today = now.toISOString().split('T')[0];
  const nowMins = now.getHours()*60 + now.getMinutes();

  PR_DATA.forEach(item=>{
    if(item.concluida || !item.data || item.data!==today || !item.inicio) return;
    const [h,m]    = item.inicio.split(':').map(Number);
    const startMins= h*60+m;
    const diff     = startMins - nowMins;
    // Alerta quando faltam entre 14 e 16 minutos (cobre a janela de checagem de 1 min)
    if(diff>=14 && diff<=16 && !_alertedMeetings.has(item.id)){
      _alertedMeetings.add(item.id);
      showMeetingAlert(item);
    }
  });
}

function showMeetingAlert(item){
  const existing = document.getElementById('meeting-alert-banner');
  if(existing) existing.remove();

  const banner = document.createElement('div');
  banner.id    = 'meeting-alert-banner';
  banner.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:9998;
    background:var(--accent);color:#fff;
    border-radius:var(--radius);padding:16px 20px;
    box-shadow:0 8px 32px rgba(79,70,229,.35);
    font-family:var(--font);max-width:320px;
    display:flex;flex-direction:column;gap:6px;
  `;
  banner.innerHTML = `
    <div style="font-size:13px;font-weight:700">⏰ Reunião em 15 minutos!</div>
    <div style="font-size:12.5px;opacity:.9"><strong>${item.nome}</strong></div>
    <div style="font-size:11.5px;opacity:.8">🕐 ${item.inicio}${item.fim?' – '+item.fim:''}</div>
    <button onclick="this.closest('#meeting-alert-banner').remove()"
      style="margin-top:4px;align-self:flex-end;background:rgba(255,255,255,.2);border:none;color:#fff;padding:4px 12px;border-radius:20px;cursor:pointer;font-family:var(--font);font-size:12px;font-weight:600">
      OK, entendido
    </button>`;
  document.body.appendChild(banner);

  setTimeout(()=>{ const el=document.getElementById('meeting-alert-banner'); if(el) el.remove(); }, 30000);

  if(window.Notification && Notification.permission==='granted'){
    new Notification('⏰ Reunião em 15 minutos!',{body:item.nome+' • '+item.inicio,icon:'',tag:'meeting_'+item.id});
  }
}

function initMeetingAlerts(){
  if(window.Notification && Notification.permission==='default'){
    Notification.requestPermission();
  }
  setInterval(checkMeetingAlerts, 60000); // checa a cada minuto
  checkMeetingAlerts(); // checagem imediata
}

// ── TEMA (Claro / Escuro / Sistema) ──
const THEME_KEY='rp2_theme'; // valores: 'light' | 'dark' | 'system'
let themeMediaQuery=null;

function applyTheme(mode){
  let effective=mode;
  if(mode==='system'){
    effective=(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light';
  }
  if(effective==='dark'){
    document.documentElement.setAttribute('data-theme','dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  document.querySelectorAll('.theme-opt').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.themeOpt===mode);
  });
}

function setTheme(mode){
  try{ localStorage.setItem(THEME_KEY, mode); }catch(e){}
  applyTheme(mode);
  setupSystemThemeListener(mode);
}

function setupSystemThemeListener(mode){
  if(!window.matchMedia) return;
  if(!themeMediaQuery) themeMediaQuery=window.matchMedia('(prefers-color-scheme: dark)');
  // Remove previous listener (idempotent)
  themeMediaQuery.onchange=null;
  if(mode==='system'){
    themeMediaQuery.onchange=()=>applyTheme('system');
  }
}

function loadTheme(){
  let mode='system';
  try{ mode=localStorage.getItem(THEME_KEY)||'system'; }catch(e){}
  applyTheme(mode);
  setupSystemThemeListener(mode);
}

// Aplica o tema imediatamente, antes do login, para evitar "flash" de tema errado
loadTheme();

// ── AUTH ──
async function enterApp(profile){
  CU = { username:profile.username, nome:profile.nome, ini:profile.ini, role:profile.role, email:profile.email };
  document.getElementById('login-screen').style.display='none';
  document.getElementById('app').style.display='flex';
  document.getElementById('snm').textContent=CU.nome;
  document.getElementById('srl').textContent=CU.role==='admin'?'Administrador':'Colaborador';
  document.getElementById('sav').textContent=CU.ini;
  document.querySelectorAll('.admin-only').forEach(el=>el.style.display=CU.role==='admin'?'':'none');
  document.getElementById('tdate').textContent=new Date().toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short',year:'numeric'});
  await loadData();
  renderPainel();
  renderUsers();
  initMeetingAlerts();
}

// Busca o perfil (tabela `profiles`) do usuário autenticado atual. Tenta de
// novo uma vez após um pequeno atraso caso o trigger que cria o perfil
// ainda não tenha rodado (signup muito recente).
async function fetchOwnProfile(){
  const { data:{ user } } = await supabase.auth.getUser();
  if(!user) return null;
  let { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if(!data){
    await new Promise(r=>setTimeout(r,900));
    ({ data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle());
  }
  return data;
}

async function doLogin(){
  const u=document.getElementById('lu').value.trim();
  const p=document.getElementById('lp').value.trim();
  const err=document.getElementById('login-err');
  const info=document.getElementById('login-info');
  err.style.display='none'; info.style.display='none';
  if(!u||!p){ err.textContent='Informe e-mail e senha.'; err.style.display='block'; return; }

  const { data, error } = await supabase.auth.signInWithPassword({ email:u, password:p });
  if(error || !data.user){
    err.textContent = (error && error.message==='Invalid login credentials') ? 'E-mail ou senha inválidos.' : ((error&&error.message)||'Não foi possível entrar.');
    err.style.display='block';
    return;
  }
  const profile = await fetchOwnProfile();
  if(!profile){
    err.textContent='Login efetuado, mas seu perfil ainda está sendo criado. Tente novamente em alguns segundos.';
    err.style.display='block';
    return;
  }
  await enterApp(profile);
}

// Primeiro acesso: cria a conta no Supabase Auth com o e-mail/senha
// informados. O gatilho `on_auth_user_created` (ver migração SQL) cria o
// perfil automaticamente — o primeiro usuário do sistema vira admin.
async function doSignup(){
  const u=document.getElementById('lu').value.trim();
  const p=document.getElementById('lp').value.trim();
  const err=document.getElementById('login-err');
  const info=document.getElementById('login-info');
  err.style.display='none'; info.style.display='none';
  if(!u||!p){ err.textContent='Informe e-mail e senha para criar a conta.'; err.style.display='block'; return; }
  if(p.length<6){ err.textContent='A senha precisa ter pelo menos 6 caracteres.'; err.style.display='block'; return; }

  const nomeDerivado = u.split('@')[0];
  const { data, error } = await supabase.auth.signUp({
    email:u, password:p, options:{ data:{ nome: nomeDerivado } },
  });
  if(error){ err.textContent=error.message; err.style.display='block'; return; }

  if(data.session){
    const profile = await fetchOwnProfile();
    if(profile){ await enterApp(profile); return; }
  }
  info.textContent='Conta criada! Se a confirmação por e-mail estiver ativa no seu projeto Supabase, verifique sua caixa de entrada e depois faça login normalmente.';
  info.style.display='block';
}

async function doLogout(){
  try{ await supabase.auth.signOut(); }catch(e){ console.error(e); }
  CU=null;
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('app').style.display='none';
}
document.getElementById('lp').addEventListener('keydown',e=>{ if(e.key==='Enter') doLogin(); });

// Restaura a sessão automaticamente (ex: usuário deu F5 na página) sem
// pedir login de novo, já que o Supabase mantém a sessão nos cookies/local.
(async function tryResumeSession(){
  try{
    const { data:{ session } } = await supabase.auth.getSession();
    if(session){
      const profile = await fetchOwnProfile();
      if(profile) await enterApp(profile);
    }
  }catch(e){ console.error('Erro ao restaurar sessão:', e); }
})();


// ── NAV ──
function showPage(p,btn){
  // Reset expanded-product state whenever leaving the "Painel de Produtos" section,
  // so products always start collapsed again on next visit
  const wasOnPainel=document.getElementById('page-painel')?.classList.contains('active');
  if(wasOnPainel && p!=='painel'){
    openProductIds.clear();
  }
  const wasOnChecklist=document.getElementById('page-checklist')?.classList.contains('active');
  if(wasOnChecklist && p!=='checklist'){
    openChecklistEtapas.clear();
  }
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  document.getElementById('page-'+p).classList.add('active');
  if(btn) btn.classList.add('active');
  const t={
    painel:'Painel de Produtos',
    analytics:'Levantamentos & Análises',
    usuarios:'Gerenciamento de Usuários',
    bi:'Painel BI — Visão Geral',
    internacional:'Painel Internacional',
    biodiversidade:'Painel Biodiversidade',
    marcas:'Painel Marcas',
    patentes:'Painel Patentes',
    anvisa:'Painel ANVISA',
    roubo:'Painel Roubo de Carga',
    licenca:'Renovação de Licença',
    demandas:'Painel de Demandas',
    'painel-reunioes':'Painel de Reuniões',
    sla:'Controle — Feriados, Pontes e Backup',
    checklist:'Checklist — Base Editável',
  };
  document.getElementById('page-title').textContent=t[p]||'';
  // Show/hide export buttons
  document.getElementById('btn-export-analytics').style.display=p==='analytics'?'inline-flex':'none';
  document.getElementById('btn-export-bi').style.display=p==='bi'?'inline-flex':'none';
  if(p==='analytics') renderAnalytics();
  if(p==='bi') renderBI();
  if(p==='usuarios'){ renderUsers(); }
  if(p==='sla'){ renderFeriadosList(); updateBackupInfo(); }
  if(p==='checklist'){ renderChecklistAdmin(); renderListEditor(); }
  if(p==='demandas') renderPainelDemandas();
  if(p==='biodiversidade') renderMP();
  if(p==='painel-reunioes') renderPainelReunioes();
}

// ── FILTERS ──
function setFilter(type, val, btn){
  if(type==='colab'){ fColab=val; document.querySelectorAll('#fc-colab .chip').forEach(c=>c.classList.remove('active')); }
  if(type==='status'){ fStatus=val; document.querySelectorAll('#fc-status .chip').forEach(c=>c.classList.remove('active')); }
  btn.classList.add('active');
  btn.style.background=val==='all'?'var(--accent)':'';
  btn.style.color=val==='all'?'#fff':'';
  btn.style.borderColor=val==='all'?'var(--accent)':'';
  applyFilters();
}

function getProdStatus(p){
  // Concluído: todas as etapas finalizadas
  const conc=ETAPAS.filter(e=>p.etapas[e.key].status==='concluida').length;
  if(conc===ETAPAS.length) return 'concluido';
  // Em andamento: há pelo menos uma etapa em-andamento
  const and=ETAPAS.filter(e=>p.etapas[e.key].status==='em-andamento').length;
  if(and>0) return 'andamento';
  // Aguardando retorno: teve retrocesso e nenhuma etapa está em-andamento (bola no outro campo)
  const temRetro=ETAPAS.some(e=>(p.etapas[e.key].retrocessos||[]).length>0);
  if(temRetro) return 'aguardando';
  // Backlog: demanda chegou mas ainda não foi iniciada
  return 'backlog';
}

function applyFilters(){
  document.querySelectorAll('.colab-card').forEach(card=>{
    const ck=card.dataset.colab;
    const showColab=fColab==='all'||fColab===ck;
    card.style.display=showColab?'':'none';
  });

  // Combined filter: status/colab chips + text search
  const term=painelSearchTerm||'';

  // Active section boxes — apply all filters normally
  document.querySelectorAll('.produtos-container .produto-box').forEach(box=>{
    const pid=box.dataset.pid;
    const p=DATA.find(x=>String(x.id)===pid);
    if(!p){box.style.display='none';return;}
    const colabOk=fColab==='all'||p.colab===fColab;
    if(getProdStatus(p)==='concluido'){box.style.display='none';return;}
    let statusOk=true;
    if(fStatus!=='all'){
      const ps=getProdStatus(p);
      if(fStatus==='prioridade') statusOk=p.prioridade;
      else if(fStatus==='esgotamento') statusOk=!!p.agEsgotamento;
      else if(fStatus==='concluido') statusOk=false;
      else statusOk=ps===fStatus;
    }
    const searchOk=!term||
      p.nome.toLowerCase().includes(term)||
      (p.marca||'').toLowerCase().includes(term)||
      (p.linha||'').toLowerCase().includes(term)||
      (p.tipo||'').toLowerCase().includes(term);
    box.style.display=(colabOk&&statusOk&&searchOk)?'':'none';
  });

  // Concluded section boxes
  document.querySelectorAll('.concluidos-body .produto-box').forEach(box=>{
    const pid=box.dataset.pid;
    const p=DATA.find(x=>String(x.id)===pid);
    if(!p){box.style.display='none';return;}
    const colabOk=fColab==='all'||p.colab===fColab;
    let hideByStatus = fStatus!=='all' && fStatus!=='concluido';
    if(fStatus==='prioridade') hideByStatus = !p.prioridade;
    if(fStatus==='esgotamento') hideByStatus = !p.agEsgotamento;
    const searchOk=!term||
      p.nome.toLowerCase().includes(term)||
      (p.marca||'').toLowerCase().includes(term)||
      (p.linha||'').toLowerCase().includes(term)||
      (p.tipo||'').toLowerCase().includes(term);
    box.style.display=(colabOk&&!hideByStatus&&searchOk)?'':'none';
  });

  // Show/hide the concluidos-section container based on filters
  document.querySelectorAll('.concluidos-section').forEach(sec=>{
    const card=sec.closest('.colab-card');
    if(!card) return;
    const ck=card.dataset.colab;
    const colabOk=fColab==='all'||fColab===ck;
    const hideByStatus=fStatus!=='all'&&fStatus!=='concluido';
    sec.style.display=(colabOk&&!hideByStatus)?'':'none';
  });
}

// ── RENDER PAINEL ──
function renderPainel(){
  const banner=document.getElementById('backup-banner');
  if(banner) banner.style.display=(CU&&CU.role==='admin'&&window._backupPendente)?'flex':'none';

  const grid=document.getElementById('colabs-grid');
  grid.innerHTML='';
  Object.keys(COLABS).forEach(ck=>{
    const c=COLABS[ck];
    const prods=DATA.filter(p=>p.colab===ck);
    const ativos=prods.filter(p=>getProdStatus(p)!=='concluido');
    const concluidos=prods.filter(p=>getProdStatus(p)==='concluido');
    const totalR=prods.reduce((s,p)=>s+ETAPAS.reduce((ss,e)=>ss+(p.etapas[e.key].retrocessos||[]).length,0),0);

    const card=document.createElement('div');
    card.className=`colab-card colab-${ck}`;
    card.dataset.colab=ck;

    const conclHTML=concluidos.length>0?`
      <div class="concluidos-section">
        <button class="concluidos-toggle" onclick="toggleConcluidos('${ck}')">
          <span id="cti-${ck}">▸</span>
          <span>✅ Concluídos</span>
          <span class="concluidos-badge">${concluidos.length}</span>
        </button>
        <div class="concluidos-body" id="cb2-${ck}" style="display:none"></div>
      </div>`:'';

    card.innerHTML=`
      <div class="colab-header">
        <div class="colab-name-area">
          <div class="colab-av" style="background:${c.cor}">${c.ini}</div>
          <div>
            <span class="colab-name">${c.nome}</span>
            <span class="colab-count">${ativos.length} ativo${ativos.length!==1?'s':''}</span>
            ${concluidos.length>0?`<span class="colab-count" style="color:var(--s-ok)"> · ${concluidos.length} concluído${concluidos.length!==1?'s':''}</span>`:''}
          </div>
        </div>
        <div class="colab-actions">
          ${totalR>0?`<span class="tag tag-retro">↩ ${totalR} retrocesso${totalR!==1?'s':''}</span>`:''}
          ${CU&&CU.role==='admin'?`<button class="btn sm" onclick="openNovoProduto('${ck}')">+ Produto</button>`:''}
        </div>
      </div>
      <div class="produtos-container" id="cb-${ck}">
        ${ativos.length===0&&concluidos.length===0?'<div class="empty-state">Nenhum produto cadastrado</div>':''}
        ${ativos.length===0&&concluidos.length>0?'<div class="empty-state" style="padding:12px 16px">Todos os produtos estão concluídos 🎉</div>':''}
      </div>
      ${conclHTML}`;

    grid.appendChild(card);

    // Render ativos
    const body=document.getElementById('cb-'+ck);
    ativos.forEach(p=>body.appendChild(mkProdBox(p)));

    // Render concluídos
    if(concluidos.length>0){
      const body2=document.getElementById('cb2-'+ck);
      concluidos.forEach(p=>body2.appendChild(mkProdBox(p)));
    }
  });
  renderInbox();
  applyFilters();
}

function toggleConcluidos(ck){
  const body=document.getElementById('cb2-'+ck);
  const icon=document.getElementById('cti-'+ck);
  const hidden=body.style.display==='none';
  body.style.display=hidden?'block':'none';
  icon.textContent=hidden?'▾':'▸';
}

function mkProdBox(p){
  const conc=ETAPAS.filter(e=>p.etapas[e.key].status==='concluida').length;
  const totalR=ETAPAS.reduce((s,e)=>s+(p.etapas[e.key].retrocessos||[]).length,0);
  const pct=Math.round(conc/ETAPAS.length*100);
  const ps=getProdStatus(p);
  const statusTag={concluido:'<span class="tag tag-ok">✅ Concluído</span>',andamento:'<span class="tag tag-and">🔄 Em andamento</span>',retrocesso:'<span class="tag tag-retro">↩ Retrocesso</span>',backlog:'<span class="tag tag-back">📦 Backlog</span>'}[ps]||'';
  const isOpen=openProductIds.has(String(p.id));

  const box=document.createElement('div');
  box.className='produto-box';
  box.dataset.pid=p.id;
  box.innerHTML=`
    <div class="produto-header" onclick="toggleProd(this)">
      <div class="produto-titulo-row">
        <span class="toggle-ic${isOpen?'':' rot'}">▾</span>
        <button class="priority-btn" title="Marcar prioridade" onclick="event.stopPropagation();togglePriority(${p.id})">${p.prioridade?'⭐':'☆'}</button>
        <button class="esgot-btn ${p.agEsgotamento?'active':''}" title="Aguardando esgotamento — regulatório finalizado, aguardando liberação de outro setor" onclick="event.stopPropagation();toggleEsgotamento(${p.id})">⏳</button>
        <span class="produto-titulo">${p.nome}</span>
        ${p.isKit?`<span class="kit-badge">📦 Kit ${p.kitItems&&p.kitItems.length>0?'('+p.kitItems.length+'p)':''}</span>`:''}
        <span style="font-size:11px;color:var(--text3);font-family:var(--mono)">${pct}%</span>
      </div>
      <div class="produto-meta">
        ${p.prioridade?'<span class="tag tag-prior">⭐ Prioridade</span>':''}
        ${p.agEsgotamento?'<span class="tag tag-esgot">⏳ Ag. Esgotamento</span>':''}
        ${totalR>0?`<span class="tag tag-retro">↩ ${totalR}</span>`:''}
        ${statusTag}
        ${CU&&CU.role==='admin'?`<button class="btn sm" onclick="event.stopPropagation();openRealoc(${p.id})" title="Realocar produto">🔄</button><button class="btn sm" style="color:var(--accent2);border-color:var(--accent2)" onclick="event.stopPropagation();delProd(${p.id})">✕</button>`:''}
      </div>
    </div>
    <div class="produto-info-row" style="display:${isOpen?'flex':'none'}">
      <div class="mini-box">
        <span class="mini-box-lbl">Marca</span>
        <select onchange="updField(${p.id},null,'marca',this.value)" onclick="event.stopPropagation()">
          <option value="">—</option>
          ${getList('marcas').map(o=>`<option ${p.marca===o?'selected':''}>${o}</option>`).join('')}
        </select>
      </div>
      <div class="mini-box" style="min-width:140px">
        <span class="mini-box-lbl">Linha</span>
        <select onchange="updField(${p.id},null,'linha',this.value)" onclick="event.stopPropagation()">
          <option value="">—</option>
          ${getList('linhas').map(o=>`<option ${p.linha===o?'selected':''}>${o}</option>`).join('')}
        </select>
      </div>
      <div class="mini-box" style="min-width:160px">
        <span class="mini-box-lbl">Tipo de Produto</span>
        <select onchange="updField(${p.id},null,'tipo',this.value)" onclick="event.stopPropagation()">
          <option value="">—</option>
          ${getList('tipos').map(o=>`<option ${p.tipo===o?'selected':''}>${o}</option>`).join('')}
        </select>
      </div>
    </div>
    ${p.isKit&&p.kitItems&&p.kitItems.length>0?`
    <div style="padding:6px 14px 0;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <span style="font-size:10.5px;color:var(--text3);font-weight:700;text-transform:uppercase;letter-spacing:.5px">Composição do kit:</span>
      ${p.kitItems.map((it,i)=>`<span style="font-size:11.5px;background:var(--accent-light);color:var(--accent);padding:1px 8px;border-radius:10px;font-weight:600">${it.nome}</span>`).join('')}
    </div>`:''}
    <div class="etapas-scroll" id="es-${p.id}" style="display:${isOpen?'flex':'none'}">
      ${ETAPAS.map(e=>mkEtapaHTML(p,e)).join('')}
    </div>`;
  return box;
}

function mkEtapaHTML(p,etapa){
  const et=p.etapas[etapa.key];
  const retros=et.retrocessos||[];
  const retornos=et.retornoEtapas||[];

  let html=mkEtapaBoxHTML(p.id, etapa, et, false, null);

  // Retorno boxes após retrocesso
  retornos.forEach((rt,ri)=>{
    html+=mkEtapaBoxHTML(p.id, etapa, rt, true, ri);
  });

  return html;
}

function mkEtapaBoxHTML(pid, etapa, et, isRetorno, retornoIdx){
  const retros=isRetorno?[]:(et.retrocessos||[]);
  const dotClass={concluida:'dot-ok','em-andamento':'dot-and','retrocesso':'dot-retro','nao-iniciada':'dot-pend'}[et.status]||'dot-pend';
  const idSuffix=isRetorno?`_r${retornoIdx}`:'';

  const retIdx= isRetorno ? `,'${retornoIdx}'` : ',null';

  return `<div class="etapa-box ${etapa.cls}${isRetorno?' is-retorno':''}">
    <div class="etapa-nome">
      <span class="etapa-nome-text" style="color:${etapa.cor}">${etapa.nome}</span>
      ${isRetorno?`<span class="retorno-badge">↩ Retorno ${retornoIdx+1}</span>`:''}
      ${et.status==='concluida'?getChecklistTag(et,etapa.key):''}
      <div class="etapa-status-dot ${dotClass}"></div>
    </div>
    <select class="etapa-sel" onchange="updStatus(${pid},'${etapa.key}',this.value${retIdx})">
      <option value="nao-iniciada" ${et.status==='nao-iniciada'?'selected':''}>Não iniciada</option>
      <option value="em-andamento" ${et.status==='em-andamento'?'selected':''}>Em andamento</option>
      <option value="concluida" ${et.status==='concluida'?'selected':''}>Concluída</option>
    </select>
    <div style="margin-top:8px">
      <div class="field-row"><span class="field-lbl">Entrada</span><input class="field-in" type="date" min="2026-01-01" value="${et.entrada||''}" onchange="updField(${pid},'${etapa.key}','entrada',this.value${retIdx})"></div>
      <div class="field-row"><span class="field-lbl">Prazo Interno</span><input class="field-in" type="date" min="2026-01-01" value="${et.prazoInterno||''}" onchange="updField(${pid},'${etapa.key}','prazoInterno',this.value${retIdx})"></div>
      <div class="field-row"><span class="field-lbl">Prazo Externo</span><input class="field-in" type="date" min="2026-01-01" value="${et.prazoExterno||''}" onchange="updField(${pid},'${etapa.key}','prazoExterno',this.value${retIdx})"></div>
      <div class="field-row"><span class="field-lbl">Início</span><input class="field-in" type="date" min="2026-01-01" value="${et.inicio||''}" onchange="updField(${pid},'${etapa.key}','inicio',this.value${retIdx})"></div>
      <div class="field-row"><span class="field-lbl">Finalização</span><input class="field-in" type="date" min="2026-01-01" value="${et.fim||''}" onchange="updField(${pid},'${etapa.key}','fim',this.value${retIdx})"></div>
    </div>
    ${!isRetorno?`<div class="retro-area">
      <div class="retro-header">
        <span class="retro-lbl">Retrocessos</span>
        ${retros.length>0?`<span class="retro-cnt">${retros.length}</span>`:''}
      </div>
      ${retros.map((r,i)=>`
        <div class="retro-item">
          <div class="ri-date">${r.data}</div>
          <div class="ri-setor">${r.setor||'—'}</div>
          <div class="ri-motivo">${r.motivo}</div>
          ${CU&&CU.role==='admin'?`<button onclick="rmRetro(${pid},'${etapa.key}',${i})" style="font-size:10px;color:var(--s-retro);background:none;border:none;cursor:pointer;margin-top:3px">✕ remover</button>`:''}
        </div>`).join('')}
      <button class="btn-add-retro" onclick="openRetro(${pid},'${etapa.key}')">+ Registrar retrocesso</button>
    </div>`:''}
  </div>`;
}

function toggleProd(hdr){
  const box=hdr.closest('.produto-box');
  const pid=box?box.dataset.pid:null;
  const scroll=hdr.parentElement.querySelector('.etapas-scroll');
  const infoRow=hdr.parentElement.querySelector('.produto-info-row');
  const ic=hdr.querySelector('.toggle-ic');
  const hidden=scroll.style.display==='none'||scroll.style.display==='';
  scroll.style.display=hidden?'flex':'none';
  if(infoRow) infoRow.style.display=hidden?'flex':'none';
  ic.classList.toggle('rot',!hidden);
  if(pid){
    if(hidden) openProductIds.add(String(pid));
    else openProductIds.delete(String(pid));
  }
}

// ── FIELD UPDATES ──
function updField(pid,ek,field,val,rIdx){
  const p=DATA.find(x=>x.id==pid); if(!p) return;
  if(rIdx!=null&&rIdx!==undefined){
    p.etapas[ek].retornoEtapas[rIdx][field]=val;
    // Auto-calc prazoInterno from entrada for retorno etapas
    if(field==='entrada'&&val&&ek){
      const slaVal=SLA[ek]||5;
      p.etapas[ek].retornoEtapas[rIdx].prazoInterno=addBusinessDays(val,slaVal);
    }
  } else if(ek){
    p.etapas[ek][field]=val;
    // Auto-calc prazoInterno from entrada
    if(field==='entrada'&&val){
      const slaVal=SLA[ek]||5;
      p.etapas[ek].prazoInterno=addBusinessDays(val,slaVal);
    }
  } else { p[field]=val; }
  save(); refreshProd(p);
}

function updStatus(pid,ek,val,rIdx){
  const p=DATA.find(x=>x.id==pid); if(!p) return;
  if(val==='concluida'){
    // Open checklist modal instead of immediately concluding
    openChecklist(pid,ek,rIdx!=null&&rIdx!==undefined?rIdx:null);
    // Reset the select visually back to previous value (checklist will apply if confirmed)
    // The refreshProd will re-render with the original value
    return;
  }
  if(rIdx!=null&&rIdx!==undefined){ p.etapas[ek].retornoEtapas[rIdx].status=val; }
  else { p.etapas[ek].status=val; }
  save(); refreshProd(p);
}

function togglePriority(pid){
  const p=DATA.find(x=>x.id==pid); if(!p) return;
  p.prioridade=!p.prioridade;
  save(); refreshProd(p);
}

function toggleEsgotamento(pid){
  const p=DATA.find(x=>x.id==pid); if(!p) return;
  p.agEsgotamento=!p.agEsgotamento;
  save(); refreshProd(p);
}

function delProd(pid){
  if(!confirm('Remover este produto?')) return;
  DATA=DATA.filter(p=>p.id!=pid); save(); renderPainel();
}

function refreshProd(p){
  // Re-render the whole analyst card so product moves between active/concluded sections
  renderPainel();
}

// ── NOVO PRODUTO ──
let npColab=null;
function openNovoProduto(ck){
  npColab=ck||null;
  if(ck) document.getElementById('np-colab').value=ck;
  // Reset kit section
  const kitChk=document.getElementById('np-iskit');
  if(kitChk) kitChk.checked=false;
  const kitBox=document.getElementById('np-kit-box');
  if(kitBox) kitBox.classList.remove('show');
  const kitItems=document.getElementById('np-kit-items');
  if(kitItems) kitItems.innerHTML='';
  kitItemCount=0;
  // Refresh dynamic selects from LISTS
  refreshModalSelects();
  document.getElementById('m-produto').classList.add('open');
}
function addProduto(){
  const nome=document.getElementById('np-nome').value.trim();
  const colab=document.getElementById('np-colab').value;
  const marca=document.getElementById('np-marca').value;
  const linha=document.getElementById('np-linha').value;
  const tipo=document.getElementById('np-tipo').value;
  const isKit=document.getElementById('np-iskit')?.checked||false;
  if(!nome){alert('Informe o nome do produto.');return;}
  // Collect kit items
  const kitItems=[];
  if(isKit){
    document.querySelectorAll('.np-kit-item-input').forEach((inp,i)=>{
      const v=inp.value.trim();
      if(v) kitItems.push({idx:i+1,nome:v});
    });
  }
  const p=mkProd(nome,colab,marca,linha,tipo);
  p.isKit=isKit;
  p.kitItems=kitItems;
  DATA.push(p);
  save(); document.getElementById('np-nome').value=''; closeM('m-produto'); renderPainel();
}

// ── RETROCESSO ──
function openRetro(pid,ek){
  retroCtx={pid,ek};
  document.getElementById('rr-data').value=new Date().toISOString().split('T')[0];
  document.getElementById('rr-etapa').value=ek;
  document.getElementById('rr-motivo').value='';
  document.getElementById('rr-setor').value='';
  document.getElementById('m-retrocesso').classList.add('open');
}
function confirmarRetrocesso(){
  const data=document.getElementById('rr-data').value;
  const etapa=document.getElementById('rr-etapa').value;
  const setor=document.getElementById('rr-setor').value;
  const motivo=document.getElementById('rr-motivo').value.trim();
  if(!data||!motivo||!setor){alert('Preencha todos os campos.');return;}
  const p=DATA.find(x=>x.id==retroCtx.pid); if(!p) return;
  const ek=retroCtx.ek;
  p.etapas[ek].retrocessos.push({data,etapa,setor,motivo});
  p.etapas[ek].status='em-andamento';
  // Criar novo box de retorno para a etapa
  p.etapas[ek].retornoEtapas.push({entrada:'',prazoInterno:'',prazoExterno:'',inicio:'',fim:'',status:'nao-iniciada',isRetorno:true,retroRef:p.etapas[ek].retrocessos.length-1});
  save(); refreshProd(p); renderPainel(); closeM('m-retrocesso');
}
function rmRetro(pid,ek,idx){
  const p=DATA.find(x=>x.id==pid); if(!p) return;
  p.etapas[ek].retrocessos.splice(idx,1);
  if(p.etapas[ek].retornoEtapas.length>idx) p.etapas[ek].retornoEtapas.splice(idx,1);
  save(); refreshProd(p);
}

function closeM(id){ document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.modal-bd').forEach(m=>m.addEventListener('click',e=>{if(e.target===m) m.classList.remove('open');}));

// ── SHARED HELPERS ──
function calcDur(p){
  let ds=[];
  ETAPAS.forEach(e=>{if(p.etapas[e.key].inicio)ds.push(new Date(p.etapas[e.key].inicio));if(p.etapas[e.key].fim)ds.push(new Date(p.etapas[e.key].fim));});
  if(ds.length<2)return null;ds.sort((a,b)=>a-b);
  return Math.round((ds[ds.length-1]-ds[0])/86400000);
}

// Returns the "current" etapa object for a product:
// - first non-concluded etapa that is em-andamento, or
// - first etapa that is not concluida (even if nao-iniciada),
// - or last etapa if all concluded
function getCurrentEtapa(p){
  const and=ETAPAS.find(e=>p.etapas[e.key].status==='em-andamento');
  if(and) return and;
  const first=ETAPAS.find(e=>p.etapas[e.key].status!=='concluida');
  if(first) return first;
  return ETAPAS[ETAPAS.length-1]; // all concluded
}

// Returns all etapas that had retrocessos, with count
function getRetroEtapas(p){
  return ETAPAS.filter(e=>(p.etapas[e.key].retrocessos||[]).length>0)
    .map(e=>({etapa:e, count:(p.etapas[e.key].retrocessos||[]).length}));
}

// ── ANALYTICS ──
function renderAnalytics(){
  const c=document.getElementById('analytics-content');
  if(!c) return;

  // ── RAW DATA CALCULATIONS ──
  const activeData=DATA.filter(p=>p.colab&&p.colab!=='inbox');
  const tot=activeData.length;
  const inboxN=DATA.filter(p=>!p.colab||p.colab==='inbox').length;
  const concP=activeData.filter(p=>getProdStatus(p)==='concluido').length;
  const andP=activeData.filter(p=>getProdStatus(p)==='andamento').length;
  const backP=activeData.filter(p=>getProdStatus(p)==='backlog').length;
  const agP=activeData.filter(p=>getProdStatus(p)==='aguardando').length;
  const prior=activeData.filter(p=>p.prioridade).length;
  const totR=activeData.reduce((s,p)=>s+ETAPAS.reduce((ss,e)=>ss+(p.etapas[e.key].retrocessos||[]).length,0),0);
  const ativas=andP+agP; // products actually in-flight

  // SLA analysis
  function isForaDePrazo(p, etapaKey, tipo){
    const et=p.etapas[etapaKey];
    const fim=et.fim||''; const ref=tipo==='int'?et.prazoInterno:et.prazoExterno;
    if(!fim||!ref) return false;
    return fim>ref;
  }
  let slaIntTotal=0, slaIntFora=0, slaExtTotal=0, slaExtFora=0;
  activeData.forEach(p=>ETAPAS.forEach(e=>{
    const et=p.etapas[e.key];
    if(et.fim&&et.prazoInterno){slaIntTotal++;if(isForaDePrazo(p,e.key,'int'))slaIntFora++;}
    if(et.fim&&et.prazoExterno){slaExtTotal++;if(isForaDePrazo(p,e.key,'ext'))slaExtFora++;}
  }));
  const pctForaInt=slaIntTotal>0?Math.round(slaIntFora/slaIntTotal*100):0;
  const pctForaExt=slaExtTotal>0?Math.round(slaExtFora/slaExtTotal*100):0;
  const pctDentroInt=100-pctForaInt;
  const pctDentroExt=100-pctForaExt;

  // Duration per etapa (avg days)
  const etapaDur={};
  ETAPAS.forEach(e=>{
    const vals=[];
    activeData.forEach(p=>{
      const et=p.etapas[e.key];
      if(et.inicio&&et.fim){
        const d=Math.round((new Date(et.fim)-new Date(et.inicio))/86400000);
        if(d>=0) vals.push(d);
      }
    });
    etapaDur[e.key]=vals.length>0?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):null;
  });
  const maxDur=Math.max(...Object.values(etapaDur).filter(v=>v!==null),1);

  // Retrocessos por etapa
  const rEtapa={};ETAPAS.forEach(e=>rEtapa[e.key]=0);
  activeData.forEach(p=>ETAPAS.forEach(e=>rEtapa[e.key]+=(p.etapas[e.key].retrocessos||[]).length));
  const maxRE=Math.max(...Object.values(rEtapa),1);

  // Retrocessos por setor
  const rSetor={};
  activeData.forEach(p=>ETAPAS.forEach(e=>(p.etapas[e.key].retrocessos||[]).forEach(r=>{if(r.setor)rSetor[r.setor]=(rSetor[r.setor]||0)+1;})));
  const maxRS=Math.max(...Object.values(rSetor),1);

  // Retrocessos por produto
  const rProd=activeData.map(p=>({nome:p.nome,colab:p.colab,r:ETAPAS.reduce((s,e)=>s+(p.etapas[e.key].retrocessos||[]).length,0)})).filter(x=>x.r>0).sort((a,b)=>b.r-a.r);
  const maxRP=Math.max(...rProd.map(x=>x.r),1);

  // Demandas por mês (entrada mais antiga de cada produto)
  const byMonth={};
  activeData.forEach(p=>{
    let minDate=null;
    ETAPAS.forEach(e=>{const d=p.etapas[e.key].entrada;if(d&&(!minDate||d<minDate))minDate=d;});
    if(minDate){
      const ym=minDate.substring(0,7);
      byMonth[ym]=(byMonth[ym]||0)+1;
    }
  });
  const monthKeys=Object.keys(byMonth).sort();
  const maxMonth=Math.max(...Object.values(byMonth),1);
  const MONTHS_PT=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  function monthLabel(ym){const[y,m]=ym.split('-');return MONTHS_PT[parseInt(m)-1]+'/'+y.slice(2);}
  function monthHeat(v){
    const pct=v/maxMonth;
    if(pct>0.75) return '#4f46e5';
    if(pct>0.5) return '#818cf8';
    if(pct>0.25) return '#c7d2fe';
    return '#eef1f8';
  }

  // Tipo análise: Lançamento vs Pós-Mercado
  // Heuristic: if etapa.anv has data → lançamento; se etapa.pos has data only → pos-mercado
  // Simple: products with linha containing known keywords or without ANVISA = pos-mercado
  // Since we don't have explicit field, classify by tipo: items that are typically post-market
  const posMarketTipos=['REPELENTE','SUPOSITÓRIO DE GLICERINA','HAND SANITIZER','MEDICAMENTOS'];
  const isPosMarket=p=>posMarketTipos.includes(p.tipo)||(p.linha&&p.linha==='MEDICAMENTOS');
  const lancamento=activeData.filter(p=>!isPosMarket(p)).length;
  const posMarket=activeData.filter(p=>isPosMarket(p)).length;
  const maxLancPos=Math.max(lancamento,posMarket,1);

  // Carga por analista
  const colabStats=Object.keys(COLABS).map(k=>{
    const ps=activeData.filter(p=>p.colab===k);
    const r=ps.reduce((s,p)=>s+ETAPAS.reduce((ss,e)=>ss+(p.etapas[e.key].retrocessos||[]).length,0),0);
    const andN=ps.filter(p=>getProdStatus(p)==='andamento').length;
    const concN=ps.filter(p=>getProdStatus(p)==='concluido').length;
    const backN=ps.filter(p=>getProdStatus(p)==='backlog').length;
    const agN=ps.filter(p=>getProdStatus(p)==='aguardando').length;
    // SLA per analyst
    let slaOkN=0,slaTotN=0;
    ps.forEach(p=>ETAPAS.forEach(e=>{const et=p.etapas[e.key];if(et.fim&&et.prazoInterno){slaTotN++;if(!isForaDePrazo(p,e.key,'int'))slaOkN++;}}));
    const slaPct=slaTotN>0?Math.round(slaOkN/slaTotN*100):null;
    const carga=andN+agN+backN;
    return {k,c:COLABS[k],ps,tot:ps.length,andN,concN,backN,agN,r,slaPct,carga};
  });
  const maxCarga=Math.max(...colabStats.map(x=>x.carga),1);

  // Fluxo rows
  const fluxoRows=activeData.map(p=>{
    const col=COLABS[p.colab]||{cor:'#8b92b4',ini:'?',nome:'—'};
    const ps=getProdStatus(p);
    const curEtapa=getCurrentEtapa(p);
    const curEt=p.etapas[curEtapa.key];
    const curStatus=curEt.status;
    const totalR=ETAPAS.reduce((s,e)=>s+(p.etapas[e.key].retrocessos||[]).length,0);
    const retroEtapas=getRetroEtapas(p);
    const dur=calcDur(p);
    const conc=ETAPAS.filter(e=>p.etapas[e.key].status==='concluida').length;
    const pct=Math.round(conc/ETAPAS.length*100);
    // SLA status for current etapa
    const slaFora=isForaDePrazo(p,curEtapa.key,'int');
    return {p,col,ps,curEtapa,curStatus,totalR,retroEtapas,dur,pct,slaFora};
  });

  function stEtTag(s){
    if(s==='concluida') return`<span class="tag tag-ok">✅ Concluída</span>`;
    if(s==='em-andamento') return`<span class="tag tag-and">🔄 Em andamento</span>`;
    return`<span class="tag tag-pend">— Não iniciada</span>`;
  }
  function stPrTag(ps){
    return{concluido:`<span class="tag tag-ok">Concluído</span>`,andamento:`<span class="tag tag-and">Em andamento</span>`,aguardando:`<span class="tag tag-wait">⏳ Ag. Retorno</span>`,backlog:`<span class="tag tag-back">Backlog</span>`}[ps]||'';
  }

  // CORS
  const CRS=['#6366f1','#ec4899','#f59e0b','#10b981','#0ea5e9','#f43f5e','#d946ef','#14b8a6'];

  c.innerHTML=`
  <!-- TABS -->
  <div class="atabs">
    <button class="atab active" onclick="switchTab('overview')">📊 Visão Geral</button>
    <button class="atab" onclick="switchTab('retrocessos')">↩ Retrocessos</button>
    <button class="atab" onclick="switchTab('sla')">⏱ SLA & Prazos</button>
    <button class="atab" onclick="switchTab('capacidade')">👥 Capacidade</button>
    <button class="atab" onclick="switchTab('demanda')">📈 Demanda</button>
    <button class="atab" onclick="switchTab('fluxo')">📋 Fluxo por Produto</button>
  </div>

  <!-- TAB: VISÃO GERAL -->
  <div class="atab-panel active" id="tab-overview">
    <div class="metrics-row">
      <div class="mc blue"><div class="mc-lbl">Total de Produtos</div><div class="mc-val">${tot}</div><div class="mc-sub">na equipe</div></div>
      <div class="mc amber"><div class="mc-lbl">Em Andamento</div><div class="mc-val">${andP}</div><div class="mc-sub">atualmente</div></div>
      <div class="mc purple"><div class="mc-lbl">Backlog</div><div class="mc-val">${backP}</div><div class="mc-sub">aguardando início</div></div>
      <div class="mc amber"><div class="mc-lbl">Ag. Retorno</div><div class="mc-val">${agP}</div><div class="mc-sub">bola no outro campo</div></div>
      <div class="mc green"><div class="mc-lbl">Concluídos</div><div class="mc-val">${concP}</div><div class="mc-sub">finalizados</div></div>
      <div class="mc red"><div class="mc-lbl">Retrocessos</div><div class="mc-val">${totR}</div><div class="mc-sub">registrados</div></div>
      <div class="mc pink"><div class="mc-lbl">Prioridades</div><div class="mc-val">${prior}</div><div class="mc-sub">sinalizados</div></div>
      <div class="mc blue"><div class="mc-lbl">Na Caixa de Entrada</div><div class="mc-val">${inboxN}</div><div class="mc-sub">sem analista</div></div>
    </div>

    <div class="insight-grid">
      <div class="insight-card">
        <div class="insight-icon" style="background:var(--accent-light)">📦</div>
        <div class="insight-body">
          <div class="insight-title">Taxa de Ocupação da Equipe</div>
          <div class="insight-val">${tot>0?Math.round(ativas/tot*100):0}%</div>
          <div class="insight-desc">${ativas} produto${ativas!==1?'s':''} ativos de ${tot} total na equipe</div>
        </div>
      </div>
      <div class="insight-card">
        <div class="insight-icon" style="background:var(--s-retro-bg)">↩</div>
        <div class="insight-body">
          <div class="insight-title">Taxa de Retrocesso</div>
          <div class="insight-val" style="color:var(--s-retro)">${tot>0?Math.round(totR/tot*10)/10:0} /produto</div>
          <div class="insight-desc">Média de retrocessos por produto cadastrado</div>
        </div>
      </div>
      <div class="insight-card">
        <div class="insight-icon" style="background:var(--s-and-bg)">⏱</div>
        <div class="insight-body">
          <div class="insight-title">Cumprimento SLA Interno</div>
          <div class="insight-val" style="color:${pctDentroInt>=80?'var(--s-ok)':'var(--s-retro)'}">${pctDentroInt}% no prazo</div>
          <div class="insight-desc">${slaIntTotal} etapas medidas · ${slaIntFora} fora do prazo</div>
        </div>
      </div>
      <div class="insight-card">
        <div class="insight-icon" style="background:var(--s-ok-bg)">✅</div>
        <div class="insight-body">
          <div class="insight-title">Conclusão de Fluxos</div>
          <div class="insight-val" style="color:var(--s-ok)">${tot>0?Math.round(concP/tot*100):0}%</div>
          <div class="insight-desc">${concP} produto${concP!==1?'s':''} com fluxo 100% concluído</div>
        </div>
      </div>
    </div>

    <div class="chart-grid-2">
      <div class="cw">
        <div class="cw-title">Distribuição de Status <span class="cw-sub">produtos ativos</span></div>
        ${[
          ['Em Andamento',andP,'#f59e0b'],
          ['Backlog',backP,'#8b5cf6'],
          ['Ag. Retorno',agP,'#f59e0b'],
          ['Concluídos',concP,'#10b981'],
        ].map(([l,v,cor])=>{
          const pct=tot>0?Math.round(v/tot*100):0;
          return`<div class="hbar-item">
            <span class="hbar-lbl sm">${l}</span>
            <div class="hbar-track"><div class="hbar-fill" style="width:${pct}%;background:${cor}"><span>${v}</span></div></div>
            <span class="hbar-num">${pct}%</span>
          </div>`;
        }).join('')}
      </div>
      <div class="cw">
        <div class="cw-title">Lançamento vs Pós-Mercado</div>
        ${[['🚀 Lançamento',lancamento,'#4f46e5'],['🔄 Pós-Mercado',posMarket,'#10b981']].map(([l,v,cor])=>{
          const pct=tot>0?Math.round(v/tot*100):0;
          return`<div class="hbar-item">
            <span class="hbar-lbl">${l}</span>
            <div class="hbar-track"><div class="hbar-fill" style="width:${pct>0?Math.max(pct,5):0}%;background:${cor}"><span>${v}</span></div></div>
            <span class="hbar-num">${pct}%</span>
          </div>`;
        }).join('')}
        <div style="margin-top:10px;font-size:11px;color:var(--text3);border-top:1px solid var(--border);padding-top:8px">
          💡 Classifique produtos como Pós-Mercado via tipo de produto (Repelente, Hand Sanitizer, etc.)
        </div>
      </div>
    </div>
  </div>

  <!-- TAB: RETROCESSOS -->
  <div class="atab-panel" id="tab-retrocessos">
    <div class="metrics-row">
      <div class="mc red"><div class="mc-lbl">Total Retrocessos</div><div class="mc-val">${totR}</div><div class="mc-sub">registrados</div></div>
      <div class="mc amber"><div class="mc-lbl">Produtos Afetados</div><div class="mc-val">${activeData.filter(p=>ETAPAS.some(e=>(p.etapas[e.key].retrocessos||[]).length>0)).length}</div><div class="mc-sub">com ≥1 retrocesso</div></div>
      <div class="mc red"><div class="mc-lbl">Setor Mais Impactante</div><div class="mc-val" style="font-size:14px">${Object.keys(rSetor).length>0?Object.entries(rSetor).sort((a,b)=>b[1]-a[1])[0][0].replace('INTERNO - ',''):'—'}</div><div class="mc-sub">maior causador</div></div>
      <div class="mc amber"><div class="mc-lbl">Etapa Mais Afetada</div><div class="mc-val" style="font-size:14px">${ETAPAS.reduce((a,b)=>rEtapa[a.key]>=rEtapa[b.key]?a:b).nome.split(' ')[0]}</div><div class="mc-sub">mais retrocessos</div></div>
    </div>

    <div class="chart-grid-2">
      <div class="cw">
        <div class="cw-title">Retrocessos por Etapa</div>
        ${ETAPAS.map(e=>{
          const v=rEtapa[e.key];const pct=Math.round(v/maxRE*100);
          return`<div class="hbar-item">
            <span class="hbar-lbl sm">${e.nome.replace('Validação Regulatória','Val. Regulatória').replace('Liberação de Rotulagem','Lib. Rotulagem').replace('Conferência de Arte','Conf. Arte').replace('Notificação ANVISA','Notif. ANVISA').replace('Etapas Pós-ANVISA','Pós-ANVISA')}</span>
            <div class="hbar-track"><div class="hbar-fill" style="width:${pct>0?Math.max(pct,4):0}%;background:${e.cor}"><span>${v}</span></div></div>
            <span class="hbar-num">${v}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="cw">
        <div class="cw-title">Retrocessos por Setor <span class="cw-sub">quem causa retrabalho</span></div>
        ${Object.keys(rSetor).length===0
          ?'<div class="empty-state">Nenhum setor registrado ainda</div>'
          :Object.entries(rSetor).sort((a,b)=>b[1]-a[1]).map(([s,v],i)=>{
            const pct=Math.round(v/maxRS*100);
            return`<div class="hbar-item">
              <span class="hbar-lbl sm" title="${s}">${s.replace('INTERNO - ','')}</span>
              <div class="hbar-track"><div class="hbar-fill" style="width:${pct>0?Math.max(pct,4):0}%;background:${CRS[i%CRS.length]}"><span>${v}</span></div></div>
              <span class="hbar-num">${v}</span>
            </div>`;
          }).join('')}
      </div>
    </div>

    <div class="cw" style="margin-bottom:14px">
      <div class="cw-title">Retrocessos por Produto <span class="cw-sub">ranking de retrabalho</span></div>
      ${rProd.length===0
        ?'<div class="empty-state">Nenhum produto com retrocesso</div>'
        :rProd.map(x=>{
          const cor=COLABS[x.colab]?.cor||'#6366f1';
          const pct=Math.round(x.r/maxRP*100);
          return`<div class="hbar-item">
            <div style="display:flex;align-items:center;gap:5px;width:200px;flex-shrink:0">
              <div style="width:18px;height:18px;border-radius:50%;background:${cor};color:#fff;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${COLABS[x.colab]?.ini||'?'}</div>
              <span class="hbar-lbl" style="width:auto">${x.nome}</span>
            </div>
            <div class="hbar-track"><div class="hbar-fill" style="width:${pct>0?Math.max(pct,3):0}%;background:${cor}"><span>${x.r} retro${x.r!==1?'s':''}</span></div></div>
            <span class="hbar-num">${x.r}</span>
          </div>`;
        }).join('')}
    </div>
  </div>

  <!-- TAB: SLA & PRAZOS -->
  <div class="atab-panel" id="tab-sla">
    <div class="metrics-row">
      <div class="mc green"><div class="mc-lbl">SLA Interno — No Prazo</div><div class="mc-val">${pctDentroInt}%</div><div class="mc-sub">${slaIntTotal-slaIntFora} de ${slaIntTotal} etapas</div></div>
      <div class="mc red"><div class="mc-lbl">SLA Interno — Fora</div><div class="mc-val">${pctForaInt}%</div><div class="mc-sub">${slaIntFora} etapas atrasadas</div></div>
      <div class="mc green"><div class="mc-lbl">SLA Externo — No Prazo</div><div class="mc-val">${pctDentroExt}%</div><div class="mc-sub">${slaExtTotal-slaExtFora} de ${slaExtTotal} etapas</div></div>
      <div class="mc red"><div class="mc-lbl">SLA Externo — Fora</div><div class="mc-val">${pctForaExt}%</div><div class="mc-sub">${slaExtFora} etapas atrasadas</div></div>
    </div>

    <div class="chart-grid-2">
      <div class="cw">
        <div class="cw-title">Cumprimento SLA Interno por Etapa</div>
        ${ETAPAS.map(e=>{
          let ok=0,tot2=0;
          activeData.forEach(p=>{const et=p.etapas[e.key];if(et.fim&&et.prazoInterno){tot2++;if(!isForaDePrazo(p,e.key,'int'))ok++;}});
          const pct=tot2>0?Math.round(ok/tot2*100):null;
          return`<div class="sla-gauge-row">
            <span class="sla-gauge-lbl">${e.nome.split(' ')[0]}</span>
            <div class="sla-gauge-track">
              ${pct!==null?`<div class="sla-gauge-ok" style="width:${pct}%;background:${pct>=80?'var(--s-ok)':pct>=60?'var(--s-and)':'var(--s-retro)'}"></div>`:'<div style="font-size:10px;color:var(--text3);padding:0 6px;line-height:10px">sem dados</div>'}
            </div>
            <span class="sla-gauge-nums">${pct!==null?pct+'% ('+ok+'/'+tot2+')':'—'}</span>
          </div>`;
        }).join('')}
      </div>
      <div class="cw">
        <div class="cw-title">Duração Média por Etapa <span class="cw-sub">dias corridos</span></div>
        ${ETAPAS.map(e=>{
          const v=etapaDur[e.key];
          const pct=v!==null?Math.round(v/maxDur*100):0;
          const slaRef=SLA[e.key]||5;
          const foraRef=v!==null&&v>slaRef;
          return`<div class="hbar-item">
            <span class="hbar-lbl sm">${e.nome.split(' ')[0]}</span>
            <div class="hbar-track"><div class="hbar-fill" style="width:${v!==null?Math.max(pct,4):0}%;background:${foraRef?'var(--s-retro)':e.cor}"><span>${v!==null?v+'d':'—'}</span></div></div>
            <span class="hbar-num" title="SLA: ${slaRef}d" style="color:${foraRef?'var(--s-retro)':'var(--text2)'}">${v!==null?v+'d':'—'}</span>
          </div>`;
        }).join('')}
        <div style="margin-top:8px;font-size:11px;color:var(--text3)">🔴 Vermelho = acima do SLA configurado</div>
      </div>
    </div>

    <div class="cw">
      <div class="cw-title">Produtos Fora do SLA Interno <span class="cw-sub">etapas com prazo estourado</span></div>
      ${(()=>{
        const fora=[];
        activeData.forEach(p=>{
          ETAPAS.forEach(e=>{
            if(isForaDePrazo(p,e.key,'int')){
              const et=p.etapas[e.key];
              const dias=Math.round((new Date(et.fim)-new Date(et.prazoInterno))/86400000);
              fora.push({prod:p.nome,colab:p.colab,etapa:e.nome,prazo:et.prazoInterno,fim:et.fim,dias});
            }
          });
        });
        if(fora.length===0) return'<div class="empty-state">✅ Nenhum produto fora do SLA interno!</div>';
        return`<table class="atable" style="margin-bottom:0">
          <thead><tr><th>Produto</th><th>Analista</th><th>Etapa</th><th>Prazo Interno</th><th>Finalizado em</th><th>Atraso</th></tr></thead>
          <tbody>${fora.map(f=>{
            const col=COLABS[f.colab]||{cor:'#8b92b4',ini:'?',nome:'—'};
            return`<tr>
              <td><strong>${f.prod}</strong></td>
              <td><div style="display:flex;align-items:center;gap:5px"><div style="width:20px;height:20px;border-radius:50%;background:${col.cor};color:#fff;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center">${col.ini}</div>${col.nome}</div></td>
              <td>${f.etapa}</td>
              <td style="font-family:var(--mono)">${f.prazo}</td>
              <td style="font-family:var(--mono)">${f.fim}</td>
              <td><span style="background:var(--s-retro-bg);color:var(--s-retro);font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px;font-family:var(--mono)">+${f.dias}d</span></td>
            </tr>`;
          }).join('')}</tbody>
        </table>`;
      })()}
    </div>
  </div>

  <!-- TAB: CAPACIDADE -->
  <div class="atab-panel" id="tab-capacidade">
    <div class="metrics-row">
      <div class="mc blue"><div class="mc-lbl">Total Produtos Ativos</div><div class="mc-val">${ativas+backP}</div><div class="mc-sub">com a equipe agora</div></div>
      <div class="mc blue"><div class="mc-lbl">Analistas Ativas</div><div class="mc-val">${Object.keys(COLABS).length}</div><div class="mc-sub">na equipe</div></div>
      <div class="mc amber"><div class="mc-lbl">Média por Analista</div><div class="mc-val">${Object.keys(COLABS).length>0?Math.round((ativas+backP)/Object.keys(COLABS).length*10)/10:0}</div><div class="mc-sub">produtos ativos/pessoa</div></div>
      <div class="mc purple"><div class="mc-lbl">Na Caixa de Entrada</div><div class="mc-val">${inboxN}</div><div class="mc-sub">aguardando delegação</div></div>
    </div>

    <div class="cw" style="margin-bottom:14px">
      <div class="cw-title">Capacidade Operacional por Analista <span class="cw-sub">demandas ativas + backlog · clique no nome para ver os produtos</span></div>
      <table class="cap-table">
        <thead><tr><th>Analista</th><th>Total</th><th>Em Andamento</th><th>Backlog</th><th>Ag. Retorno</th><th>Concluídos</th><th>Retrocessos</th><th>SLA Interno</th><th>Carga</th></tr></thead>
        <tbody>
          ${colabStats.map(x=>{
            const capPct=maxCarga>0?Math.round(x.carga/maxCarga*100):0;
            const slaColor=x.slaPct===null?'var(--text3)':x.slaPct>=80?'var(--s-ok)':x.slaPct>=60?'#b45309':'var(--s-retro)';
            const prodListHTML=x.ps.length===0
              ?'<div class="empty-state" style="padding:14px">Nenhum produto delegado a esta analista</div>'
              :`<table class="cap-prod-table">
                <thead><tr><th>Produto</th><th>Marca</th><th>Tipo</th><th>Etapa Atual</th><th>Status</th></tr></thead>
                <tbody>
                  ${x.ps.map(p=>{
                    const ps2=getProdStatus(p);
                    const curEt=getCurrentEtapa(p);
                    return`<tr>
                      <td><div style="display:flex;align-items:center;gap:5px">${p.prioridade?'⭐':''}${p.agEsgotamento?'⏳':''}<strong>${p.nome}</strong></div></td>
                      <td style="font-size:11.5px">${p.marca||'—'}</td>
                      <td style="font-size:11px">${p.tipo||'—'}</td>
                      <td><div style="display:flex;align-items:center;gap:4px">
                        <div style="width:7px;height:7px;border-radius:50%;background:${curEt.cor};flex-shrink:0"></div>
                        <span style="font-size:11.5px;font-weight:600;color:${curEt.cor}">${curEt.nome}</span>
                      </div></td>
                      <td>${stPrTag(ps2)}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>`;
            return`<tr class="cap-row" onclick="toggleCapProds('${x.k}')">
              <td><div style="display:flex;align-items:center;gap:7px;cursor:pointer">
                <div style="width:26px;height:26px;border-radius:50%;background:${x.c.cor};color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center">${x.c.ini}</div>
                <strong style="text-decoration:underline;text-decoration-style:dotted;text-decoration-color:var(--border2)">${x.c.nome}</strong>
                <span class="cap-toggle-ic" id="cap-ic-${x.k}" style="font-size:10px;color:var(--text3)">▸</span>
              </div></td>
              <td style="font-family:var(--mono);font-weight:700">${x.tot}</td>
              <td style="font-family:var(--mono);color:#b45309">${x.andN}</td>
              <td style="font-family:var(--mono);color:var(--s-back)">${x.backN}</td>
              <td style="font-family:var(--mono);color:var(--s-and)">${x.agN}</td>
              <td style="font-family:var(--mono);color:var(--s-ok)">${x.concN}</td>
              <td style="font-family:var(--mono);color:${x.r>0?'var(--s-retro)':'var(--text3)'}">${x.r}</td>
              <td style="font-family:var(--mono);color:${slaColor}">${x.slaPct!==null?x.slaPct+'%':'—'}</td>
              <td style="min-width:100px">
                <div style="display:flex;align-items:center;gap:6px">
                  <div style="flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden">
                    <div class="cap-bar" style="width:${capPct}%;background:${capPct>80?'var(--s-retro)':capPct>60?'var(--s-and)':'var(--s-ok)'}"></div>
                  </div>
                  <span style="font-family:var(--mono);font-size:11px">${x.carga}</span>
                </div>
              </td>
            </tr>
            <tr class="cap-prods-row" id="cap-row-${x.k}" style="display:none">
              <td colspan="9" style="padding:0;background:var(--bg)">
                <div style="padding:12px 16px">${prodListHTML}</div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>

    <div class="cw">
      <div class="cw-title">💡 Indicadores para Justificativa de Contratação</div>
      <div class="insight-grid" style="margin-top:10px;margin-bottom:0">
        <div class="insight-card" style="border-color:var(--accent)">
          <div class="insight-icon" style="background:var(--accent-light)">👥</div>
          <div class="insight-body">
            <div class="insight-title">Demanda Total vs Capacidade</div>
            <div class="insight-val">${tot} produtos / ${Object.keys(COLABS).length} analistas</div>
            <div class="insight-desc">Média de ${Math.round(tot/Math.max(Object.keys(COLABS).length,1)*10)/10} produtos por analista</div>
          </div>
        </div>
        <div class="insight-card" style="border-color:var(--s-retro)">
          <div class="insight-icon" style="background:var(--s-retro-bg)">↩</div>
          <div class="insight-body">
            <div class="insight-title">Impacto de Retrabalho</div>
            <div class="insight-val" style="color:var(--s-retro)">${totR} retrocessos</div>
            <div class="insight-desc">Cada retrocesso gera retrabalho e aumenta o tempo de ciclo da equipe</div>
          </div>
        </div>
        <div class="insight-card" style="border-color:var(--s-and)">
          <div class="insight-icon" style="background:var(--s-and-bg)">📦</div>
          <div class="insight-body">
            <div class="insight-title">Backlog Acumulado</div>
            <div class="insight-val" style="color:var(--s-back)">${backP} produtos</div>
            <div class="insight-desc">Produtos aguardando início — indicador direto de sobrecarga operacional</div>
          </div>
        </div>
        <div class="insight-card" style="border-color:var(--s-ok)">
          <div class="insight-icon" style="background:var(--s-ok-bg)">📤</div>
          <div class="insight-body">
            <div class="insight-title">Etapa que Mais Consome Tempo</div>
            <div class="insight-val" style="font-size:14px">${ETAPAS.reduce((a,b)=>(etapaDur[a.key]||0)>=(etapaDur[b.key]||0)?a:b).nome}</div>
            <div class="insight-desc">Foco de melhoria para ganho de produtividade</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- TAB: DEMANDA -->
  <div class="atab-panel" id="tab-demanda">
    <div class="metrics-row">
      <div class="mc blue"><div class="mc-lbl">Meses com Dados</div><div class="mc-val">${monthKeys.length}</div><div class="mc-sub">com demandas</div></div>
      <div class="mc amber"><div class="mc-lbl">Pico de Demanda</div><div class="mc-val">${maxMonth}</div><div class="mc-sub">${monthKeys.length>0?monthLabel(monthKeys[Object.values(byMonth).indexOf(maxMonth)]):'—'}</div></div>
      <div class="mc blue"><div class="mc-lbl">Média Mensal</div><div class="mc-val">${monthKeys.length>0?Math.round(Object.values(byMonth).reduce((a,b)=>a+b,0)/monthKeys.length*10)/10:0}</div><div class="mc-sub">produtos/mês</div></div>
      <div class="mc purple"><div class="mc-lbl">Maior Tipo</div><div class="mc-val" style="font-size:13px">${(()=>{const tc={};activeData.forEach(p=>{if(p.tipo)tc[p.tipo]=(tc[p.tipo]||0)+1;});const e=Object.entries(tc).sort((a,b)=>b[1]-a[1]);return e.length>0?e[0][0]:'—';})()}</div><div class="mc-sub">tipo mais demandado</div></div>
    </div>

    <div class="cw" style="margin-bottom:14px">
      <div class="cw-title">Demanda Mensal <span class="cw-sub">entrada de produtos por mês — use para planejar temporários</span></div>
      ${monthKeys.length===0
        ?'<div class="empty-state">Preencha as datas de entrada nas etapas para visualizar</div>'
        :`<div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
          ${monthKeys.map(ym=>{
            const v=byMonth[ym];
            const pct=Math.round(v/maxMonth*100);
            const isMax=v===maxMonth;
            return`<div class="hbar-item">
              <span class="hbar-lbl sm" style="${isMax?'color:var(--s-retro);font-weight:800':''}">${monthLabel(ym)}${isMax?' 🔥':''}</span>
              <div class="hbar-track"><div class="hbar-fill" style="width:${pct>0?Math.max(pct,3):0}%;background:${isMax?'var(--s-retro)':'var(--accent)'}"><span>${v}</span></div></div>
              <span class="hbar-num">${v}</span>
            </div>`;
          }).join('')}
        </div>`}
    </div>

    <div class="chart-grid-2">
      <div class="cw">
        <div class="cw-title">Top 10 Tipos de Produto <span class="cw-sub">o que mais ocupa a equipe</span></div>
        ${(()=>{
          const tc={};activeData.forEach(p=>{if(p.tipo)tc[p.tipo]=(tc[p.tipo]||0)+1;});
          const sorted=Object.entries(tc).sort((a,b)=>b[1]-a[1]).slice(0,10);
          const maxT=sorted.length>0?sorted[0][1]:1;
          return sorted.length===0?'<div class="empty-state">Sem dados de tipo</div>':
          sorted.map(([t,v],i)=>{
            const pct=Math.round(v/maxT*100);
            return`<div class="hbar-item">
              <span class="hbar-lbl sm" title="${t}">${t.length>18?t.substring(0,16)+'…':t}</span>
              <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(pct,3)}%;background:${CRS[i%CRS.length]}"><span>${v}</span></div></div>
              <span class="hbar-num">${v}</span>
            </div>`;
          }).join('');
        })()}
      </div>
      <div class="cw">
        <div class="cw-title">Demanda por Marca</div>
        ${(()=>{
          const mc2={};activeData.forEach(p=>{if(p.marca)mc2[p.marca]=(mc2[p.marca]||0)+1;});
          const sorted=Object.entries(mc2).sort((a,b)=>b[1]-a[1]);
          const maxM=sorted.length>0?sorted[0][1]:1;
          return sorted.length===0?'<div class="empty-state">Sem dados de marca</div>':
          sorted.map(([m,v],i)=>{
            const pct=Math.round(v/maxM*100);
            return`<div class="hbar-item">
              <span class="hbar-lbl sm">${m}</span>
              <div class="hbar-track"><div class="hbar-fill" style="width:${Math.max(pct,3)}%;background:${CRS[i%CRS.length]}"><span>${v}</span></div></div>
              <span class="hbar-num">${v}</span>
            </div>`;
          }).join('');
        })()}
      </div>
    </div>
  </div>

  <!-- TAB: FLUXO POR PRODUTO -->
  <div class="atab-panel" id="tab-fluxo">
    <div style="margin-bottom:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <span style="font-size:12px;font-weight:700;color:var(--text3)">FILTRAR:</span>
      <select id="af-colab" onchange="filterFluxo()" style="font-size:12px;padding:5px 8px">
        <option value="">Todas as analistas</option>
        ${Object.keys(COLABS).map(k=>`<option value="${k}">${COLABS[k].nome}</option>`).join('')}
      </select>
      <select id="af-status" onchange="filterFluxo()" style="font-size:12px;padding:5px 8px">
        <option value="">Todos os status</option>
        <option value="backlog">Backlog</option>
        <option value="andamento">Em andamento</option>
        <option value="aguardando">Ag. Retorno</option>
        <option value="concluido">Concluído</option>
      </select>
      <select id="af-esgot" onchange="filterFluxo()" style="font-size:12px;padding:5px 8px">
        <option value="">Ag. Esgotamento: Todos</option>
        <option value="sim">⏳ Apenas Ag. Esgotamento</option>
      </select>
      <select id="af-marca" onchange="filterFluxo()" style="font-size:12px;padding:5px 8px">
        <option value="">Todas as marcas</option>
        ${[...new Set(activeData.map(p=>p.marca).filter(Boolean))].sort().map(m=>`<option value="${m}">${m}</option>`).join('')}
      </select>
      <input id="af-search" placeholder="🔍 Buscar produto..." oninput="filterFluxo()" style="font-size:12px;padding:5px 10px;min-width:160px">
      <button class="btn sm" onclick="clearFluxoFilters()">✕ Limpar</button>
    </div>
    <div id="fluxo-table-wrap">
    <table class="atable" id="fluxo-table">
      <thead>
        <tr>
          <th>Produto</th><th>Analista</th><th>Marca</th><th>Tipo</th>
          <th>Etapa Atual</th><th>Status Etapa</th>
          <th>Etapas c/ Retrocesso</th><th>Nº Retro.</th>
          <th>Duração</th><th>Progresso</th><th>Status Produto</th><th>Ag. Esgot.</th><th>SLA Int.</th>
        </tr>
      </thead>
      <tbody id="fluxo-tbody">
        ${fluxoRows.map(({p,col,ps,curEtapa,curStatus,totalR,retroEtapas,dur,pct,slaFora})=>{
          const retroCell=retroEtapas.length===0
            ?'<span style="color:var(--text3)">—</span>'
            :retroEtapas.map(re=>`<span style="display:inline-flex;align-items:center;gap:2px;background:var(--s-retro-bg);color:var(--s-retro);font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;margin:1px">${re.etapa.nome.split(' ')[0]}(${re.count})</span>`).join('');
          return`<tr data-colab="${p.colab}" data-status="${ps}" data-marca="${p.marca}" data-nome="${p.nome.toLowerCase()}" data-esgot="${p.agEsgotamento?'sim':'nao'}">
            <td><div style="display:flex;align-items:center;gap:5px">${p.prioridade?'⭐':''}<strong>${p.nome}</strong></div></td>
            <td><div style="display:flex;align-items:center;gap:5px">
              <div style="width:22px;height:22px;border-radius:50%;background:${col.cor};color:#fff;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${col.ini}</div>
              ${col.nome}
            </div></td>
            <td style="font-size:11.5px">${p.marca||'—'}</td>
            <td style="font-size:11px">${p.tipo||'—'}</td>
            <td><div style="display:flex;align-items:center;gap:4px">
              <div style="width:7px;height:7px;border-radius:50%;background:${curEtapa.cor};flex-shrink:0"></div>
              <span style="font-size:11.5px;font-weight:600;color:${curEtapa.cor}">${curEtapa.nome}</span>
            </div></td>
            <td>${stEtTag(curStatus)}</td>
            <td style="max-width:160px">${retroCell}</td>
            <td style="text-align:center;font-family:var(--mono);font-weight:700;color:${totalR>0?'var(--s-retro)':'var(--text3)'}">${totalR>0?totalR:'—'}</td>
            <td style="font-family:var(--mono);font-size:12px">${dur!==null?dur+'d':'—'}</td>
            <td><div class="bar-cell">
              <div class="bar-bg"><div class="bar-fill" style="width:${pct}%"></div></div>
              <span style="font-family:var(--mono);font-size:11px">${pct}%</span>
            </div></td>
            <td>${stPrTag(ps)}</td>
            <td>${p.agEsgotamento?'<span class="tag tag-esgot">⏳ Sim</span>':'<span style="color:var(--text3)">—</span>'}</td>
            <td>${slaFora?'<span class="tag tag-retro">Fora</span>':'<span class="tag tag-ok">OK</span>'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
    </div>
  </div>`;

  // Tab switching function
  window.switchTab=function(id){
    document.querySelectorAll('.atab').forEach((t,i)=>{
      const ids=['overview','retrocessos','sla','capacidade','demanda','fluxo'];
      t.classList.toggle('active',ids[i]===id);
    });
    document.querySelectorAll('.atab-panel').forEach(p=>p.classList.remove('active'));
    const el=document.getElementById('tab-'+id);
    if(el) el.classList.add('active');
  };

  window.toggleCapProds=function(ck){
    const row=document.getElementById('cap-row-'+ck);
    const ic=document.getElementById('cap-ic-'+ck);
    if(!row) return;
    const hidden=row.style.display==='none';
    row.style.display=hidden?'table-row':'none';
    if(ic) ic.textContent=hidden?'▾':'▸';
  };

  window.filterFluxo=function(){
    const colab=document.getElementById('af-colab')?.value||'';
    const status=document.getElementById('af-status')?.value||'';
    const marca=document.getElementById('af-marca')?.value||'';
    const esgot=document.getElementById('af-esgot')?.value||'';
    const search=document.getElementById('af-search')?.value.toLowerCase()||'';
    document.querySelectorAll('#fluxo-tbody tr').forEach(row=>{
      const ok=(!colab||row.dataset.colab===colab)&&
                (!status||row.dataset.status===status)&&
                (!marca||row.dataset.marca===marca)&&
                (!esgot||row.dataset.esgot===esgot)&&
                (!search||row.dataset.nome.includes(search));
      row.style.display=ok?'':'none';
    });
  };
  window.clearFluxoFilters=function(){
    ['af-colab','af-status','af-marca','af-esgot'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
    const s=document.getElementById('af-search');if(s)s.value='';
    document.querySelectorAll('#fluxo-tbody tr').forEach(r=>r.style.display='');
  };
}

// ── BI PANEL ── (one row per product)
function renderBI(){
  const c=document.getElementById('bi-content');

  function buildRows(){
    return DATA.map(p=>{
      const col=COLABS[p.colab];
      const ps=getProdStatus(p);
      const curEtapa=getCurrentEtapa(p);
      const curEt=p.etapas[curEtapa.key];
      const totalR=ETAPAS.reduce((s,e)=>s+(p.etapas[e.key].retrocessos||[]).length,0);
      const retroEtapas=getRetroEtapas(p);
      const setores=[...new Set(ETAPAS.flatMap(e=>(p.etapas[e.key].retrocessos||[]).map(r=>r.setor).filter(Boolean)))].join(', ');
      const dur=calcDur(p);
      const conc=ETAPAS.filter(e=>p.etapas[e.key].status==='concluida').length;
      const pct=Math.round(conc/ETAPAS.length*100);
      const curEtSt={concluida:'Concluída','em-andamento':'Em andamento','nao-iniciada':'Não iniciada'}[curEt.status]||'Não iniciada';
      const stProd={concluido:'Concluído',andamento:'Em andamento',aguardando:'Ag. Retorno',backlog:'Backlog'}[ps]||'Backlog';
      const retroEtStr=retroEtapas.map(re=>`${re.etapa.nome} (${re.count})`).join(' / ')||'—';
      // dates from current etapa
      return {
        prod:p.nome, colab:col.nome, colabKey:p.colab,
        marca:p.marca||'', linha:p.linha||'', tipo:p.tipo||'',
        prioridade:p.prioridade?'Sim':'Não',
        agEsgotamento:p.agEsgotamento?'Sim':'Não',
        etapaAtual:curEtapa.nome,
        statusEtapa:curEtSt,
        entrada:curEt.entrada||'', prazoInt:curEt.prazoInterno||'',
        prazoExt:curEt.prazoExterno||'', inicio:curEt.inicio||'', fim:curEt.fim||'',
        etapasRetro:retroEtStr,
        retrossosTotal:totalR,
        setoresRetro:setores||'—',
        statusProd:stProd,
        duracao:dur!==null?dur+'d':'—',
        pct:pct+'%',
        pid:p.id
      };
    });
  }

  let rows=buildRows();
  let sf={colab:'',marca:'',linha:'',tipo:'',etapaAtual:'',statusProd:'',prioridade:'',agEsgotamento:''};
  let ss={col:'prod',dir:1};
  let search='';

  const cols=[
    {k:'prod',lbl:'Produto',w:'180px'},
    {k:'colab',lbl:'Analista',w:'110px'},
    {k:'marca',lbl:'Marca',w:'90px'},
    {k:'linha',lbl:'Linha',w:'120px'},
    {k:'tipo',lbl:'Tipo',w:'130px'},
    {k:'prioridade',lbl:'Prioridade',w:'80px'},
    {k:'agEsgotamento',lbl:'Ag. Esgotamento',w:'110px'},
    {k:'etapaAtual',lbl:'Etapa Atual',w:'160px'},
    {k:'statusEtapa',lbl:'Status Etapa',w:'120px'},
    {k:'entrada',lbl:'Entrada',w:'90px'},
    {k:'prazoInt',lbl:'Pz. Interno',w:'90px'},
    {k:'prazoExt',lbl:'Pz. Externo',w:'90px'},
    {k:'inicio',lbl:'Início',w:'90px'},
    {k:'fim',lbl:'Fim',w:'90px'},
    {k:'etapasRetro',lbl:'Etapas c/ Retrocesso',w:'190px'},
    {k:'retrossosTotal',lbl:'Total Retro.',w:'90px'},
    {k:'setoresRetro',lbl:'Setores Retrocesso',w:'180px'},
    {k:'statusProd',lbl:'Status Produto',w:'120px'},
    {k:'duracao',lbl:'Duração',w:'75px'},
    {k:'pct',lbl:'Progresso',w:'75px'},
  ];

  function getUniqueVals(k){ return [...new Set(rows.map(r=>r[k]).filter(v=>v&&v!=='—'))].sort(); }

  function fmtCell(k,v,row){
    if(k==='prioridade') return v==='Sim'?'<span style="color:#f43f5e;font-weight:700">⭐ Sim</span>':'<span style="color:var(--text3)">—</span>';
    if(k==='agEsgotamento') return v==='Sim'?'<span class="tag tag-esgot">⏳ Sim</span>':'<span style="color:var(--text3)">—</span>';
    if(k==='statusEtapa'){
      const m={Concluída:'tag-ok','Em andamento':'tag-and','Não iniciada':'tag-pend'};
      return `<span class="tag ${m[v]||'tag-pend'}">${v}</span>`;
    }
    if(k==='statusProd'){
      const m={Concluído:'tag-ok','Em andamento':'tag-and','Ag. Retorno':'tag-wait',Backlog:'tag-back',Retrocesso:'tag-wait'};
      return `<span class="tag ${m[v]||'tag-pend'}">${v}</span>`;
    }
    if(k==='retrossosTotal'){
      if(!v||v==='0'||v===0) return '<span style="color:var(--text3)">—</span>';
      return `<span style="color:var(--s-retro);font-weight:700;font-family:var(--mono)">${v}</span>`;
    }
    if(k==='etapasRetro'&&v&&v!=='—') return `<span style="color:var(--s-retro);font-size:11.5px">${v}</span>`;
    if(k==='colab'){
      const col=COLABS[row.colabKey];
      return col?`<div style="display:flex;align-items:center;gap:5px"><div style="width:20px;height:20px;border-radius:50%;background:${col.cor};color:#fff;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${col.ini}</div><span>${v}</span></div>`:v;
    }
    if(k==='etapaAtual'){
      const et=ETAPAS.find(e=>e.nome===v);
      return et?`<div style="display:flex;align-items:center;gap:5px"><div style="width:8px;height:8px;border-radius:50%;background:${et.cor};flex-shrink:0"></div><span style="font-weight:600;color:${et.cor}">${v}</span></div>`:v;
    }
    if(k==='pct'){
      const n=parseInt(v)||0;
      return`<div style="display:flex;align-items:center;gap:5px"><div style="width:50px;height:5px;background:var(--surface2);border-radius:3px;overflow:hidden"><div style="height:100%;width:${n}%;background:var(--accent);border-radius:3px"></div></div><span style="font-family:var(--mono);font-size:11px">${v}</span></div>`;
    }
    return (!v||v==='—')?'<span style="color:var(--text3)">—</span>':String(v);
  }

  function render(){
    c.innerHTML=`
      <div class="section-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>Painel BI — <span id="bi-count" style="color:var(--accent);font-family:var(--mono)">${rows.length}</span> de ${rows.length} produtos</span>
        <div style="display:flex;gap:8px">
          <button class="btn sm" onclick="clearBIFilters()">✕ Limpar filtros</button>
          <button class="btn sm primary" onclick="exportCSV()">⬇ Exportar CSV</button>
        </div>
      </div>
      <div class="bi-panel">
        <div class="bi-filter-row">
          <input id="bi-search-input" placeholder="🔍  Buscar produto..." value="${search}" oninput="setBISearch(this.value)" style="min-width:170px">
          ${['colab','marca','tipo','etapaAtual','statusProd','prioridade','agEsgotamento'].map(k=>`
            <select onchange="setBIFilter('${k}',this.value)">
              <option value="">${cols.find(col=>col.k===k)?.lbl||k}: Todos</option>
              ${getUniqueVals(k).map(v=>`<option value="${v}" ${sf[k]===v?'selected':''}>${v}</option>`).join('')}
            </select>`).join('')}
        </div>
        <div class="bi-table-wrap" id="bi-table-wrap"></div>
      </div>`;
    renderTable();
  }

  function renderTable(){
    let filtered=rows.filter(r=>{
      const matchSearch=!search||r.prod.toLowerCase().includes(search.toLowerCase());
      const matchFilters=Object.keys(sf).every(k=>!sf[k]||String(r[k])===sf[k]);
      return matchSearch&&matchFilters;
    });
    filtered.sort((a,b)=>String(a[ss.col]||'').localeCompare(String(b[ss.col]||''),undefined,{numeric:true})*ss.dir);

    const wrap=document.getElementById('bi-table-wrap');
    if(wrap) wrap.innerHTML=`
      <table class="bi-table">
        <thead><tr>${cols.map(col=>`<th style="min-width:${col.w}" onclick="sortBI('${col.k}')">${col.lbl}<span class="sort-ic">${ss.col===col.k?(ss.dir===1?' ▲':' ▼'):' ⇅'}</span></th>`).join('')}</tr></thead>
        <tbody>
          ${filtered.length===0
            ?`<tr><td colspan="${cols.length}" style="text-align:center;padding:32px;color:var(--text3)">Nenhum produto encontrado com esses filtros</td></tr>`
            :filtered.map(row=>`<tr>${cols.map(col=>`<td style="min-width:${col.w}">${fmtCell(col.k,row[col.k],row)}</td>`).join('')}</tr>`).join('')}
        </tbody>
      </table>`;
    const countEl=document.getElementById('bi-count');
    if(countEl) countEl.textContent=filtered.length;
  }

  window.setBIFilter=function(k,v){sf[k]=v;render();};
  window.setBISearch=function(v){
    search=v;
    renderTable(); // only re-render the table, keep the input focused and untouched
  };
  window.sortBI=function(k){if(ss.col===k)ss.dir*=-1;else{ss.col=k;ss.dir=1;}renderTable();};
  window.clearBIFilters=function(){sf={};search='';render();};
  window.exportCSV=function(){
    const hd=cols.map(col=>col.lbl).join(',');
    const body=rows.map(row=>cols.map(col=>'"'+String(row[col.k]||'').replace(/"/g,'""')+'"').join(',')).join('\n');
    const blob=new Blob(['\ufeff'+hd+'\n'+body],{type:'text/csv;charset=utf-8'});
    const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='regulapro_export.csv';a.click();
  };

  render();
}

// ── USERS ──
// ── SLA & FERIADOS ──
let SLA = {val:5, rot:3, art:3, anv:10, pos:5};
let FERIADOS = []; // array of "YYYY-MM-DD" strings (feriados + pontes)
let FERIADOS_LABELS={};

async function loadSLA(){
  try{
    const { data, error } = await supabase.from('sla_config').select('*').eq('id',1).maybeSingle();
    if(error) throw error;
    if(data) SLA = { val:data.val, rot:data.rot, art:data.art, anv:data.anv, pos:data.pos };
  }catch(e){ console.error('Erro ao carregar sla_config do Supabase:', e); }

  try{
    const { data, error } = await supabase.from('feriados').select('*').order('data');
    if(error) throw error;
    FERIADOS = (data||[]).map(r=>r.data);
    FERIADOS_LABELS = {};
    (data||[]).forEach(r=>{ FERIADOS_LABELS[r.data]=r.nome; });
  }catch(e){ console.error('Erro ao carregar feriados do Supabase:', e); }

  ETAPAS.forEach(e=>{
    const el=document.getElementById('sla-'+e.key);
    if(el) el.value=SLA[e.key]||5;
  });
  renderFeriadosList();
}

async function saveSLA(){
  const oldSLA={...SLA};
  ETAPAS.forEach(e=>{
    const el=document.getElementById('sla-'+e.key);
    if(el) SLA[e.key]=parseInt(el.value)||5;
  });
  try{
    const { error } = await supabase.from('sla_config').upsert({ id:1, ...SLA });
    if(error) throw error;
  }catch(e){ console.error('Erro ao salvar sla_config no Supabase:', e); }

  // Recalcular automaticamente o Prazo Interno de todas as etapas EM ANDAMENTO
  // (ainda não finalizadas) com base na nova configuração de SLA, a partir da data de Entrada já registrada.
  let atualizados=0;
  DATA.forEach(p=>{
    ETAPAS.forEach(e=>{
      const et=p.etapas[e.key];
      if(et.entrada && et.status!=='concluida' && SLA[e.key]!==oldSLA[e.key]){
        et.prazoInterno=addBusinessDays(et.entrada, SLA[e.key]);
        atualizados++;
      }
      // Também recalcular retornos (retrocessos) em andamento
      (et.retornoEtapas||[]).forEach(rt=>{
        if(rt.entrada && rt.status!=='concluida' && SLA[e.key]!==oldSLA[e.key]){
          rt.prazoInterno=addBusinessDays(rt.entrada, SLA[e.key]);
        }
      });
    });
  });
  save();
  renderPainel();

  const msg=document.getElementById('sla-msg');
  msg.textContent=atualizados>0?`✓ Salvo! ${atualizados} prazo(s) recalculado(s)`:'✓ Salvo!';
  msg.style.display='inline';setTimeout(()=>msg.style.display='none',3000);
}

// Add business days (skip Sat/Sun AND feriados/pontes cadastrados) to a date string "YYYY-MM-DD"
function addBusinessDays(dateStr, days){
  if(!dateStr||!days) return '';
  let d=new Date(dateStr+'T12:00:00');
  let added=0;
  while(added<days){
    d.setDate(d.getDate()+1);
    const dow=d.getDay();
    const iso=d.toISOString().split('T')[0];
    const isFeriado=FERIADOS.includes(iso);
    if(dow!==0&&dow!==6&&!isFeriado) added++;
  }
  return d.toISOString().split('T')[0];
}

// ── FERIADOS / PONTES MANAGEMENT (admin) ──
async function addFeriado(){
  const dateEl=document.getElementById('feriado-data');
  const lblEl=document.getElementById('feriado-nome');
  const date=dateEl.value;
  const nome=lblEl.value.trim();
  if(!date){alert('Selecione uma data.');return;}
  if(FERIADOS.includes(date)){alert('Esta data já está cadastrada.');return;}
  FERIADOS.push(date);
  FERIADOS_LABELS[date]=nome||'Feriado/Ponte';
  FERIADOS.sort();
  try{
    const { error } = await supabase.from('feriados').upsert({ data:date, nome:FERIADOS_LABELS[date] });
    if(error) throw error;
  }catch(e){ console.error('Erro ao salvar feriado no Supabase:', e); }
  dateEl.value='';lblEl.value='';
  renderFeriadosList();
}

async function removeFeriado(date){
  FERIADOS=FERIADOS.filter(d=>d!==date);
  delete FERIADOS_LABELS[date];
  try{
    const { error } = await supabase.from('feriados').delete().eq('data', date);
    if(error) throw error;
  }catch(e){ console.error('Erro ao remover feriado no Supabase:', e); }
  renderFeriadosList();
}

// Compatibilidade: FERIADOS_LABELS já é carregado junto com FERIADOS em loadSLA() — no-op.
function loadFeriadosLabels(){}

function renderFeriadosList(){
  const el=document.getElementById('feriados-list');
  if(!el) return;
  loadFeriadosLabels();
  if(FERIADOS.length===0){
    el.innerHTML='<div class="empty-state" style="padding:16px">Nenhum feriado ou ponte cadastrado ainda</div>';
    return;
  }
  el.innerHTML=FERIADOS.map(d=>{
    const dt=new Date(d+'T12:00:00');
    const fmt=dt.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',weekday:'short'});
    return `<div class="feriado-item">
      <div><strong>${fmt}</strong> <span style="color:var(--text3)">— ${FERIADOS_LABELS[d]||'Feriado/Ponte'}</span></div>
      <button onclick="removeFeriado('${d}')" title="Remover">✕</button>
    </div>`;
  }).join('');
}

// ── INBOX ──
function renderInbox(){
  const container=document.getElementById('inbox-container');
  if(!container) return;
  const inboxProds=DATA.filter(p=>!p.colab||p.colab==='inbox');
  if(inboxProds.length===0){container.innerHTML='';return;}
  container.innerHTML=`
    <div class="inbox-card">
      <div class="inbox-header">
        <div class="inbox-title">
          <div class="inbox-icon">📥</div>
          <span>Caixa de Entrada — Sem Analista</span>
          <span class="inbox-count">${inboxProds.length} produto${inboxProds.length!==1?'s':''}</span>
        </div>
        <span style="font-size:12px;color:var(--text3)">Delegue os produtos abaixo para as analistas</span>
      </div>
      <div class="inbox-body">
        ${inboxProds.map(p=>`
          <div class="inbox-prod" data-pid="${p.id}">
            <div style="display:flex;flex-direction:column;gap:3px;flex:1;min-width:140px">
              <div class="inbox-prod-name">${p.prioridade?'⭐ ':''}${p.nome}</div>
              <div style="display:flex;gap:5px;flex-wrap:wrap">
                ${p.marca?`<span class="tag tag-pend" style="font-size:10px">${p.marca}</span>`:''}
                ${p.linha?`<span class="tag tag-pend" style="font-size:10px">${p.linha}</span>`:''}
                ${p.tipo?`<span class="tag tag-pend" style="font-size:10px">${p.tipo}</span>`:''}
              </div>
            </div>
            ${CU&&CU.role==='admin'?`
            <div class="inbox-delegate">
              <select id="delegate-sel-${p.id}">
                <option value="">Selecionar analista...</option>
                <option value="ana">Ana</option>
                <option value="bea">Beatriz</option>
                <option value="car">Carla</option>
                <option value="dan">Daniela</option>
                <option value="eli">Elisabete</option>
                <option value="fab">Fabiana</option>
              </select>
              <button class="btn-delegate" onclick="delegarProduto(${p.id})">Delegar →</button>
            </div>`:'<span style="font-size:12px;color:var(--text3)">Aguardando delegação</span>'}
          </div>`).join('')}
      </div>
    </div>`;
}

function delegarProduto(pid){
  const sel=document.getElementById('delegate-sel-'+pid);
  const colab=sel?.value;
  if(!colab){alert('Selecione uma analista.');return;}
  const p=DATA.find(x=>x.id==pid); if(!p) return;
  if(!p.realocHistory) p.realocHistory=[];
  p.realocHistory.push({de:'inbox',para:colab,data:new Date().toISOString().split('T')[0],motivo:'Delegação inicial'});
  p.colab=colab;
  save(); renderPainel(); renderInbox();
}

let realocCtx=null;
function openRealoc(pid){
  const p=DATA.find(x=>x.id==pid); if(!p) return;
  realocCtx=pid;
  document.getElementById('realoc-nome').value=p.nome;
  document.getElementById('realoc-colab').value='';
  document.getElementById('realoc-motivo').value='';
  document.getElementById('m-realoc').classList.add('open');
}
function confirmarRealoc(){
  const colab=document.getElementById('realoc-colab').value;
  const motivo=document.getElementById('realoc-motivo').value.trim();
  if(!colab){alert('Selecione o destino.');return;}
  const p=DATA.find(x=>x.id==realocCtx); if(!p) return;
  if(!p.realocHistory) p.realocHistory=[];
  p.realocHistory.push({de:p.colab,para:colab,data:new Date().toISOString().split('T')[0],motivo:motivo||'Realocação'});
  p.colab=colab;
  save(); closeM('m-realoc'); renderPainel(); renderInbox();
}

// ── USERS MANAGEMENT ──
async function toggleUserRole(username){
  const profile = PROFILES_BY_ID[username];
  if(!profile) return;
  const admins = Object.values(USERS).filter(u=>u.role==='admin');
  if(profile.role==='admin' && admins.length<=1){
    alert('Não é possível remover o último administrador do sistema.');
    return;
  }
  const novoRole = profile.role==='admin' ? 'member' : 'admin';
  try{
    const { error } = await supabase.from('profiles').update({ role:novoRole }).eq('id', profile.id);
    if(error) throw error;
  }catch(e){ alert('Não foi possível alterar o papel: '+e.message); return; }
  await loadUsers();
  renderUsers();
}

// Sem service_role no servidor não é possível definir a senha de outra
// pessoa diretamente — em vez disso, disparamos o e-mail oficial de
// redefinição de senha do Supabase para o endereço cadastrado.
async function resetUserPassword(username){
  const profile = PROFILES_BY_ID[username];
  if(!profile || !profile.email) return;
  if(!confirm(`Enviar e-mail de redefinição de senha para ${profile.email}?`)) return;
  try{
    const { error } = await supabase.auth.resetPasswordForEmail(profile.email);
    if(error) throw error;
    alert('E-mail de redefinição de senha enviado para '+profile.email+'.');
  }catch(e){ alert('Não foi possível enviar o e-mail: '+e.message); }
}

// Convida/cria um novo usuário (ação de admin). Usa um cliente Supabase
// isolado (sem persistir sessão) para não substituir a sessão do admin
// logado no navegador — não requer chave service_role.
async function inviteNewUser(){
  const email=prompt('E-mail do novo usuário:');
  if(!email) return;
  const senha=prompt('Senha temporária (mín. 6 caracteres) — combine com a pessoa antes:');
  if(!senha||senha.length<6){ alert('Senha muito curta (mínimo 6 caracteres).'); return; }
  const nome=prompt('Nome de exibição (opcional):','') || email.split('@')[0];
  try{
    const isolated = window.supabaseIsolatedFactory();
    const { error } = await isolated.auth.signUp({ email, password:senha, options:{ data:{ nome } } });
    if(error) throw error;
    alert('Usuário criado! Peça para a pessoa entrar com este e-mail e senha (e trocar a senha depois, se quiser).');
    await loadUsers();
    renderUsers();
  }catch(e){ alert('Não foi possível criar o usuário: '+e.message); }
}
window.inviteNewUser = inviteNewUser;

// ── EXPORT EXCEL (CSV multi-sheet via multiple downloads) ──
function exportExcel(type){
  if(type==='bi') exportBIExcel();
  else if(type==='analytics') exportAnalyticsExcel();
}

function csvDownload(rows, filename){
  const csv=rows.map(r=>r.map(c=>'"'+String(c==null?'':c).replace(/"/g,'""')+'"').join(',')).join('\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();
}

function exportBIExcel(){
  const rows=[['Produto','Analista','Marca','Linha','Tipo','Prioridade','Etapa Atual','Status Etapa','Entrada','Prazo Interno','Prazo Externo','Início','Fim','Etapas c/ Retrocesso','Total Retrocessos','Setores Retrocesso','Status Produto','Duração (dias)','Progresso (%)']];
  DATA.forEach(p=>{
    const col=COLABS[p.colab]||{nome:'Sem analista'};
    const ps=getProdStatus(p);
    const curEtapa=getCurrentEtapa(p);
    const curEt=p.etapas[curEtapa.key];
    const totalR=ETAPAS.reduce((s,e)=>s+(p.etapas[e.key].retrocessos||[]).length,0);
    const retroEtapas=getRetroEtapas(p).map(re=>re.etapa.nome+'('+re.count+')').join(' / ')||'—';
    const setores=[...new Set(ETAPAS.flatMap(e=>(p.etapas[e.key].retrocessos||[]).map(r=>r.setor).filter(Boolean)))].join(', ')||'—';
    const dur=calcDur(p);
    const conc=ETAPAS.filter(e=>p.etapas[e.key].status==='concluida').length;
    const pct=Math.round(conc/ETAPAS.length*100);
    const stEt={concluida:'Concluída','em-andamento':'Em andamento','nao-iniciada':'Não iniciada'}[curEt.status]||'Não iniciada';
    const stProd={concluido:'Concluído',andamento:'Em andamento',aguardando:'Ag. Retorno',backlog:'Backlog'}[ps]||'Backlog';
    rows.push([p.nome,col.nome,p.marca||'',p.linha||'',p.tipo||'',p.prioridade?'Sim':'Não',curEtapa.nome,stEt,curEt.entrada||'',curEt.prazoInterno||'',curEt.prazoExterno||'',curEt.inicio||'',curEt.fim||'',retroEtapas,totalR,setores,stProd,dur!==null?dur:'',pct]);
  });
  csvDownload(rows,'regulapro_bi_'+new Date().toISOString().split('T')[0]+'.csv');
}

function exportAnalyticsExcel(){
  // Sheet 1: Fluxo por produto
  const rows1=[['Produto','Analista','Marca','Tipo','Etapa Atual','Status Etapa','Etapas c/ Retrocesso','Total Retrocessos','Duração (dias)','Progresso (%)','Status Produto']];
  DATA.forEach(p=>{
    const col=COLABS[p.colab]||{nome:'Sem analista'};
    const ps=getProdStatus(p);
    const curEtapa=getCurrentEtapa(p);
    const curEt=p.etapas[curEtapa.key];
    const totalR=ETAPAS.reduce((s,e)=>s+(p.etapas[e.key].retrocessos||[]).length,0);
    const retroEtapas=getRetroEtapas(p).map(re=>re.etapa.nome+'('+re.count+')').join(' / ')||'—';
    const dur=calcDur(p);
    const conc=ETAPAS.filter(e=>p.etapas[e.key].status==='concluida').length;
    const pct=Math.round(conc/ETAPAS.length*100);
    const stEt={concluida:'Concluída','em-andamento':'Em andamento','nao-iniciada':'Não iniciada'}[curEt.status]||'Não iniciada';
    const stProd={concluido:'Concluído',andamento:'Em andamento',aguardando:'Ag. Retorno',backlog:'Backlog'}[ps]||'Backlog';
    rows1.push([p.nome,col.nome,p.marca||'',p.tipo||'',curEtapa.nome,stEt,retroEtapas,totalR,dur!==null?dur:'',pct,stProd]);
  });
  csvDownload(rows1,'regulapro_levantamentos_'+new Date().toISOString().split('T')[0]+'.csv');

  // Sheet 2: Retrocessos detalhados
  setTimeout(()=>{
    const rows2=[['Produto','Analista','Etapa','Data Retrocesso','Setor','Motivo']];
    DATA.forEach(p=>{
      const col=COLABS[p.colab]||{nome:'Sem analista'};
      ETAPAS.forEach(e=>{
        (p.etapas[e.key].retrocessos||[]).forEach(r=>{
          rows2.push([p.nome,col.nome,e.nome,r.data||'',r.setor||'',r.motivo||'']);
        });
      });
    });
    if(rows2.length>1) csvDownload(rows2,'regulapro_retrocessos_'+new Date().toISOString().split('T')[0]+'.csv');
  },800);
}

function renderUsers(){
  const g=document.getElementById('users-grid');if(!g)return;
  const avatarColors=['#4f46e5','#0ea5e9','#10b981','#f59e0b','#ec4899','#f43f5e','#6366f1','#d946ef'];
  g.innerHTML=Object.entries(USERS).map(([u,d],i)=>`
    <div class="user-card">
      <div class="uc-top">
        <div class="uc-av" style="background:${avatarColors[i%avatarColors.length]}">${d.ini}</div>
        <div><div class="uc-name">${d.nome}</div><div class="uc-role">${d.email||'@'+u}</div></div>
      </div>
      <span class="${d.role==='admin'?'badge-admin':'badge-member'}">${d.role==='admin'?'👑 Administrador':'👤 Colaborador'}</span>
      ${CU&&CU.role==='admin'?`
      <div class="user-card-actions">
        <button class="btn-toggle-role" onclick="toggleUserRole('${u}')">${d.role==='admin'?'↓ Tornar Colaborador':'↑ Tornar Admin'}</button>
        <button class="btn-toggle-role" onclick="resetUserPassword('${u}')">🔑 Redefinir senha</button>
      </div>`:''}
    </div>`).join('');
}
