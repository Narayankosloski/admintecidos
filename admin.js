(function () {
  var firebaseConfig = {
    apiKey: "AIzaSyBBriPa_yCqb7kZtyJJ2XGtOp_DSCYCx0Q",
    authDomain: "bancodetecidos-c3d2d.firebaseapp.com",
    databaseURL: "https://bancodetecidos-c3d2d-default-rtdb.firebaseio.com",
    projectId: "bancodetecidos-c3d2d",
    storageBucket: "bancodetecidos-c3d2d.firebasestorage.app",
    messagingSenderId: "534574467325",
    appId: "1:534574467325:web:1ad5399163637660b25694",
    measurementId: "G-24ZTWH1YZY"
  };

  firebase.initializeApp(firebaseConfig);
  var auth = firebase.auth();
  var db = firebase.firestore();
  var moldesRef = db.collection('moldes');

  // ATENÇÃO: troque pelo(s) e-mail(s) da conta Google que pode administrar os
  // moldes. Só quem estiver nesta lista consegue ver/editar o painel — qualquer
  // outra conta Google que logar aqui recebe a tela de acesso negado.
  // Isso é uma proteção só na tela; o que realmente impede escrita indevida são
  // as regras do Firestore (veja o aviso no fim deste arquivo).
  var ADMIN_EMAILS = [
    'yankosloski@gmail.com'
  ];

  var CATEGORY_COLORS = [
    { color: '#B23A2E', bg: '#F4E0DD' },
    { color: '#3A4A6B', bg: '#DEE3EC' },
    { color: '#B9812A', bg: '#F2E4CC' },
    { color: '#5C6B4E', bg: '#E1E6DA' },
    { color: '#7C4A8A', bg: '#E9DDEC' }
  ];

  var UNIDADES = ['m', 'cm', 'un', 'kg', 'g'];

  var state = {
    moldes: [],
    loaded: false,
    dataError: null,
    formOpen: false,
    editingId: null,
    draft: null,
    search: ''
  };

  var currentUser = null;
  var isAdmin = false;
  var unsubMoldes = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toNumber(str) {
    if (str === undefined || str === null || str === '') return NaN;
    return parseFloat(String(str).replace(',', '.'));
  }

  function formatarNumero(v) {
    var n = toNumber(v);
    if (isNaN(n)) n = 0;
    return n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  }

  function catColor(cat) {
    var idx = 0;
    var c = cat || 'Molde';
    for (var i = 0; i < c.length; i++) idx += c.charCodeAt(i);
    return CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
  }

  function novoDraft() {
    return { nome: '', descricao: '', fotoUrl: '', categoria: '', ativo: true, materiais: [{ nome: '', quantidade: '', unidade: 'm' }] };
  }

  // ---------- Autenticação ----------

  function renderAuthBar() {
    var bar = document.getElementById('ct-authbar');
    if (!bar) return;
    if (currentUser) {
      bar.innerHTML =
        '<div class="ct-authbar">' +
          '<div class="ct-authbar-user">' +
            (currentUser.photoURL ? '<img src="' + esc(currentUser.photoURL) + '" />' : '') +
            '<span>' + esc(currentUser.displayName || currentUser.email) + '</span>' +
          '</div>' +
          '<button class="ct-btn ct-btn-ghost" id="ct-logout-btn">Sair</button>' +
        '</div>';
      var logoutBtn = document.getElementById('ct-logout-btn');
      if (logoutBtn) logoutBtn.addEventListener('click', function () { auth.signOut(); });
    } else {
      bar.innerHTML = '';
    }
  }

  function renderLoginScreen() {
    var root = document.getElementById('ct-root');
    root.innerHTML =
      '<div class="ct-login-box">' +
        '<b>Painel de administração de moldes</b>' +
        '<p>Entre com a conta Google autorizada para gerenciar o catálogo.</p>' +
        '<button class="ct-google-btn" id="ct-google-login">Entrar com Google</button>' +
      '</div>';
    var btn = document.getElementById('ct-google-login');
    if (btn) btn.addEventListener('click', function () {
      var provider = new firebase.auth.GoogleAuthProvider();
      auth.signInWithPopup(provider).catch(function (err) {
        console.error(err);
        var root2 = document.getElementById('ct-root');
        if (root2) root2.innerHTML += '<p class="ct-error" style="text-align:center">Não foi possível entrar (' + esc(err.code || err.message) + '). Tente novamente.</p>';
      });
    });
  }

  function renderAccessDenied() {
    var root = document.getElementById('ct-root');
    root.innerHTML =
      '<div class="ct-admin-denied">' +
        '<b>Acesso restrito</b>' +
        '<p>A conta <b>' + esc(currentUser.email) + '</b> não tem permissão para administrar os moldes.</p>' +
        '<button class="ct-btn ct-btn-ghost" id="ct-denied-logout">Sair e tentar outra conta</button>' +
      '</div>';
    var btn = document.getElementById('ct-denied-logout');
    if (btn) btn.addEventListener('click', function () { auth.signOut(); });
  }

  auth.onAuthStateChanged(function (user) {
    currentUser = user;
    isAdmin = !!(user && ADMIN_EMAILS.indexOf(user.email) > -1);
    if (unsubMoldes) { unsubMoldes(); unsubMoldes = null; }
    renderAuthBar();

    var shell = document.querySelector('.ct-shell');
    if (shell) shell.classList.toggle('ct-shell-noauth', !user || !isAdmin);

    if (user && isAdmin) {
      state.loaded = false;
      state.dataError = null;
      unsubMoldes = moldesRef.orderBy('criadoEm', 'desc').onSnapshot(function (snap) {
        state.moldes = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
        state.loaded = true;
        state.dataError = null;
        render();
      }, function (err) {
        console.error('Erro ao ler moldes', err);
        state.loaded = true;
        state.dataError = err.code || err.message;
        render();
      });
    } else if (user && !isAdmin) {
      renderAccessDenied();
    } else {
      state.moldes = [];
      state.loaded = true;
      state.formOpen = false;
      state.draft = null;
      renderLoginScreen();
    }
  });

  // ---------- Formulário ----------

  function openNewForm() {
    state.formOpen = true;
    state.editingId = null;
    state.draft = novoDraft();
    render();
  }

  function openEditForm(id) {
    var m = state.moldes.find(function (x) { return x.id === id; });
    if (!m) return;
    state.formOpen = true;
    state.editingId = id;
    state.draft = {
      nome: m.nome || '',
      descricao: m.descricao || '',
      fotoUrl: m.fotoUrl || '',
      categoria: m.categoria || '',
      ativo: m.ativo !== false,
      materiais: (m.materiais && m.materiais.length ? m.materiais : [{ nome: '', quantidade: '', unidade: 'm' }])
        .map(function (mat) { return { nome: mat.nome || '', quantidade: mat.quantidade === undefined ? '' : String(mat.quantidade).replace('.', ','), unidade: mat.unidade || 'm' }; })
    };
    render();
  }

  function closeForm() {
    state.formOpen = false;
    state.editingId = null;
    state.draft = null;
    render();
  }

  function syncDraftFromDOM() {
    if (!state.formOpen || !state.draft) return;
    var v = state.draft;
    var get = function (id) { var el = document.getElementById(id); return el ? el.value : undefined; };
    if (get('ct-f-nome') !== undefined) v.nome = get('ct-f-nome');
    if (get('ct-f-categoria') !== undefined) v.categoria = get('ct-f-categoria');
    if (get('ct-f-foto') !== undefined) v.fotoUrl = get('ct-f-foto');
    if (get('ct-f-desc') !== undefined) v.descricao = get('ct-f-desc');
    var ativoEl = document.getElementById('ct-f-ativo');
    if (ativoEl) v.ativo = ativoEl.checked;
    // Os campos de materiais (linhas dinâmicas) NÃO são sincronizados aqui de propósito:
    // esta função roda no topo de todo render(), inclusive logo depois de adicionar/remover
    // uma linha em memória — se ela também lesse as linhas do DOM (que nesse momento ainda
    // são as antigas, de antes do clique), reescreveria state.draft.materiais por cima e
    // desfazia a linha recém-adicionada. Por isso os materiais têm sua própria função,
    // chamada só nos pontos em que isso é seguro (ver syncMateriaisFromDOM).
  }

  // Lê os valores atualmente digitados nas linhas de materiais e devolve o array —
  // chamada explicitamente (nunca pelo syncDraftFromDOM genérico) para não apagar
  // linhas recém adicionadas/removidas em memória antes do próximo render.
  function syncMateriaisFromDOM() {
    if (!state.formOpen || !state.draft) return;
    var rows = document.querySelectorAll('.ct-mat-row');
    if (!rows.length) return;
    var materiais = [];
    rows.forEach(function (row) {
      var nome = row.querySelector('.ct-mat-nome');
      var qtd = row.querySelector('.ct-mat-qtd');
      var un = row.querySelector('.ct-mat-un');
      materiais.push({
        nome: nome ? nome.value : '',
        quantidade: qtd ? qtd.value : '',
        unidade: un ? un.value : 'm'
      });
    });
    state.draft.materiais = materiais;
  }

  function addMaterialRow() {
    syncMateriaisFromDOM();
    state.draft.materiais.push({ nome: '', quantidade: '', unidade: 'm' });
    render();
  }

  function removeMaterialRow(idx) {
    syncMateriaisFromDOM();
    state.draft.materiais.splice(idx, 1);
    if (state.draft.materiais.length === 0) state.draft.materiais.push({ nome: '', quantidade: '', unidade: 'm' });
    render();
  }

  function submitForm() {
    syncDraftFromDOM();
    syncMateriaisFromDOM();
    var v = state.draft;
    var errEl = document.getElementById('ct-form-error');
    if (!v.nome || !v.nome.trim()) { errEl.textContent = 'Informe o nome do molde.'; return; }

    var materiaisLimpos = [];
    for (var i = 0; i < v.materiais.length; i++) {
      var m = v.materiais[i];
      if (!m.nome || !m.nome.trim()) continue;
      var qtd = toNumber(m.quantidade);
      if (isNaN(qtd) || qtd < 0) { errEl.textContent = 'Quantidade inválida em "' + m.nome + '".'; return; }
      materiaisLimpos.push({ nome: m.nome.trim(), quantidade: Math.round(qtd * 1000) / 1000, unidade: m.unidade || 'm' });
    }

    errEl.textContent = '';
    var payload = {
      nome: v.nome.trim(),
      descricao: (v.descricao || '').trim(),
      fotoUrl: (v.fotoUrl || '').trim(),
      categoria: (v.categoria || '').trim(),
      ativo: !!v.ativo,
      materiais: materiaisLimpos
    };

    var promise;
    if (state.editingId) {
      promise = moldesRef.doc(state.editingId).set(payload, { merge: true });
    } else {
      payload.criadoEm = firebase.firestore.FieldValue.serverTimestamp();
      promise = moldesRef.add(payload);
    }

    errEl.textContent = 'Salvando...';
    var submitBtn = document.getElementById('ct-submit-form');
    if (submitBtn) submitBtn.disabled = true;

    promise.then(function () {
      state.formOpen = false;
      state.editingId = null;
      state.draft = null;
      render();
    }).catch(function (e) {
      console.error('Erro ao salvar molde', e);
      var errEl2 = document.getElementById('ct-form-error');
      if (errEl2) errEl2.textContent = 'Não foi possível salvar (' + (e.code || e.message) + '). Confira as regras do Firestore para a coleção "moldes".';
      var submitBtn2 = document.getElementById('ct-submit-form');
      if (submitBtn2) submitBtn2.disabled = false;
    });
  }

  function toggleAtivo(id) {
    var m = state.moldes.find(function (x) { return x.id === id; });
    if (!m) return;
    moldesRef.doc(id).set({ ativo: !(m.ativo !== false) }, { merge: true }).catch(function (e) {
      console.error('Erro ao atualizar status do molde', e);
    });
  }

  function deleteMolde(id) {
    var m = state.moldes.find(function (x) { return x.id === id; });
    var ok = window.confirm('Excluir o molde "' + (m ? m.nome : '') + '"? Ele some do catálogo para todo mundo.');
    if (!ok) return;
    moldesRef.doc(id).delete().catch(function (e) { console.error('Erro ao excluir molde', e); });
  }

  // ---------- Render ----------

  function renderForm() {
    var v = state.draft;
    var matRows = v.materiais.map(function (m, idx) {
      var unOptions = UNIDADES.map(function (u) { return '<option value="' + u + '"' + (u === m.unidade ? ' selected' : '') + '>' + u + '</option>'; }).join('');
      return '<div class="ct-mat-row">' +
        '<input class="ct-mat-nome" placeholder="Ex.: Tecido algodão liso" value="' + esc(m.nome) + '" />' +
        '<input class="ct-mat-qtd" placeholder="2,5" value="' + esc(m.quantidade) + '" />' +
        '<select class="ct-mat-un">' + unOptions + '</select>' +
        '<button type="button" class="ct-mat-remove" data-remove-mat="' + idx + '" title="Remover">&#10005;</button>' +
        '</div>';
    }).join('');

    return '' +
      '<div class="ct-overlay">' +
      '<p class="ct-form-title">' + (state.editingId ? 'Editar molde' : 'Novo molde') + '</p>' +
      '<div class="ct-field"><label>Nome *</label><input id="ct-f-nome" value="' + esc(v.nome) + '" placeholder="Vestido Midi Evasê" /></div>' +
      '<div class="ct-row2">' +
      '<div class="ct-field"><label>Categoria</label><input id="ct-f-categoria" value="' + esc(v.categoria) + '" placeholder="Vestido" /></div>' +
      '<div class="ct-field"><label>URL da foto</label><input id="ct-f-foto" value="' + esc(v.fotoUrl) + '" placeholder="https://..." /></div>' +
      '</div>' +
      '<div class="ct-field"><label>Descrição</label><input id="ct-f-desc" value="' + esc(v.descricao) + '" placeholder="Breve descrição do molde" /></div>' +
      '<div class="ct-field"><label><input type="checkbox" id="ct-f-ativo"' + (v.ativo ? ' checked' : '') + ' style="width:auto;margin-right:6px" />Publicado (visível no catálogo)</label></div>' +
      '<div class="ct-field"><label>Materiais necessários</label>' + matRows +
      '<span class="ct-optional-toggle" id="ct-add-mat">+ adicionar material</span>' +
      '</div>' +
      '<div id="ct-form-error" class="ct-error"></div>' +
      '<div class="ct-form-actions">' +
      '<button class="ct-btn" id="ct-submit-form">' + (state.editingId ? 'Salvar alterações' : 'Criar molde') + '</button>' +
      '<button class="ct-btn ct-btn-ghost" id="ct-cancel-form">Cancelar</button>' +
      '</div>' +
      '</div>';
  }

  function renderMoldeRow(m) {
    var cc = catColor(m.categoria);
    var ativo = m.ativo !== false;
    var qtdMateriais = (m.materiais || []).length;
    return '' +
      '<div class="ct-card">' +
      '<div class="ct-pinked" style="--tag-color:' + cc.color + '"></div>' +
      '<div class="ct-card-body">' +
      (m.fotoUrl ? '<img class="ct-molde-foto" src="' + esc(m.fotoUrl) + '" alt="" />' : '') +
      '<div class="ct-card-top">' +
      '<div class="ct-card-name">' + esc(m.nome) + '</div>' +
      '<div class="ct-card-actions">' +
      '<button class="ct-icon-btn" data-edit="' + m.id + '" title="Editar">&#9998;</button>' +
      '<button class="ct-icon-btn" data-del="' + m.id + '" title="Excluir">&#10005;</button>' +
      '</div>' +
      '</div>' +
      (m.categoria ? '<span class="ct-tag" style="--tag-color:' + cc.color + ';--tag-bg:' + cc.bg + '">' + esc(m.categoria) + '</span>' : '') +
      '<div class="ct-card-row"><span>Status</span><span><span class="' + (ativo ? 'ct-badge-ativo' : 'ct-badge-inativo') + '">' + (ativo ? 'Publicado' : 'Oculto') + '</span></span></div>' +
      '<div class="ct-card-row"><span>Materiais cadastrados</span><span>' + qtdMateriais + '</span></div>' +
      '<div class="ct-form-actions" style="margin-top:8px">' +
      '<button class="ct-btn ct-btn-ghost" data-toggle-ativo="' + m.id + '">' + (ativo ? 'Ocultar do catálogo' : 'Publicar no catálogo') + '</button>' +
      '</div>' +
      '</div>' +
      '</div>';
  }

  function filteredMoldes() {
    if (!state.search) return state.moldes;
    var q = state.search.toLowerCase();
    return state.moldes.filter(function (m) {
      return ((m.nome || '') + ' ' + (m.categoria || '')).toLowerCase().indexOf(q) > -1;
    });
  }

  function render() {
    if (!currentUser || !isAdmin) return;
    syncDraftFromDOM();

    var nav = document.getElementById('ct-nav');
    if (nav) nav.innerHTML = '<div class="ct-nav-item active"><span class="ct-nav-icon">&#128204;</span><span>Moldes</span></div>';

    var root = document.getElementById('ct-root');
    if (!state.loaded) { root.innerHTML = '<div class="ct-loading">Carregando moldes...</div>'; return; }

    if (state.dataError) {
      root.innerHTML = '<div class="ct-empty"><b>Não foi possível acessar os dados</b>Erro: ' + esc(state.dataError) + '.<br/>Confira as regras do Firestore para a coleção <b>moldes</b>.</div>';
      return;
    }

    var items = filteredMoldes();
    var html = '<div class="ct-page-header"><h2>Moldes</h2><p>Cadastre, edite e publique os moldes do catálogo.</p></div>';
    html += '<div class="ct-toolbar">' +
      '<input class="ct-search" id="ct-search-input" placeholder="Buscar molde" value="' + esc(state.search) + '" />' +
      '<button class="ct-btn" id="ct-open-new">+ Novo molde</button>' +
      '</div>';

    if (items.length === 0) {
      html += '<div class="ct-empty"><b>' + (state.moldes.length === 0 ? 'Nenhum molde cadastrado ainda' : 'Nada encontrado') + '</b>' +
        (state.moldes.length === 0 ? 'Crie o primeiro molde do catálogo.' : 'Tente outra busca.') + '</div>';
    } else {
      html += '<div class="ct-grid">' + items.map(renderMoldeRow).join('') + '</div>';
    }

    if (state.formOpen) html += renderForm();

    root.innerHTML = html;
    attachEvents();
  }

  function attachEvents() {
    var root = document.getElementById('ct-root');

    var searchInput = document.getElementById('ct-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function (e) {
        state.search = e.target.value;
        var pos = e.target.selectionStart;
        render();
        var again = document.getElementById('ct-search-input');
        if (again) { again.focus(); again.setSelectionRange(pos, pos); }
      });
    }

    var openNew = document.getElementById('ct-open-new');
    if (openNew) openNew.addEventListener('click', openNewForm);

    root.querySelectorAll('[data-edit]').forEach(function (el) {
      el.addEventListener('click', function () { openEditForm(el.getAttribute('data-edit')); });
    });
    root.querySelectorAll('[data-del]').forEach(function (el) {
      el.addEventListener('click', function () { deleteMolde(el.getAttribute('data-del')); });
    });
    root.querySelectorAll('[data-toggle-ativo]').forEach(function (el) {
      el.addEventListener('click', function () { toggleAtivo(el.getAttribute('data-toggle-ativo')); });
    });

    var submitBtn = document.getElementById('ct-submit-form');
    if (submitBtn) submitBtn.addEventListener('click', submitForm);
    var cancelBtn = document.getElementById('ct-cancel-form');
    if (cancelBtn) cancelBtn.addEventListener('click', closeForm);

    var addMat = document.getElementById('ct-add-mat');
    if (addMat) addMat.addEventListener('click', addMaterialRow);
    root.querySelectorAll('[data-remove-mat]').forEach(function (el) {
      el.addEventListener('click', function () { removeMaterialRow(parseInt(el.getAttribute('data-remove-mat'), 10)); });
    });
  }
})();

/*
IMPORTANTE — regras do Firestore:
A coleção "moldes" agora é global (fora de usuarios/{uid}). Adicione algo assim
nas regras do Firestore (console do Firebase > Firestore Database > Regras),
mantendo o que já existe para "usuarios/{uid}/...":

  match /moldes/{moldeId} {
    allow read: if request.auth != null;
    allow write: if request.auth != null && request.auth.token.email in [
      'SEU-EMAIL-AQUI@gmail.com'
    ];
  }

Troque 'SEU-EMAIL-AQUI@gmail.com' pelo mesmo e-mail que você colocou em
ADMIN_EMAILS no topo deste arquivo. Sem essa regra publicada, qualquer
conta Google logada conseguiria editar os moldes escrevendo direto no
Firestore, mesmo sem passar por esta tela.
*/