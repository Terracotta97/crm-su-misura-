/* =========================
   UNICA CRM - app.js (SPA)
   Versione Completa con tutte le funzionalità
   ========================= */

(() => {
  /* -------------------- Utils -------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    });
    (Array.isArray(children) ? children : [children]).forEach(c => {
      if (c == null) return;
      if (c instanceof Node) node.appendChild(c);
      else node.insertAdjacentHTML("beforeend", c);
    });
    return node;
  };
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const euro = (n) => (Number(n || 0)).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
  const fmtDate = (d) => d ? dayjs(d).format('DD/MM/YYYY') : '';
  const fmtDT = (d) => d ? dayjs(d).format('DD/MM/YYYY HH:mm') : '';
  const toISODateTime = (val) => {
  if (!val) return null;
  return dayjs(val).format('YYYY-MM-DDTHH:mm:ss');
};

  const productTypes = [
    'infissi',
    'tapparelle',
    'zanzariere',
    'scuri_persiane',
    'cassonetti',
    'porta_blindata',
    'porte_interne',
    'pergole'
  ];

  const productLabel = (pt) => (pt === 'scuri' || pt === 'scuri_persiane') ? 'scuri/persiane' : String(pt || '').replace(/_/g, ' ');

function apiProductType(pt) {
  if (pt === 'scuri_persiane') return 'scuri';
  if (pt === 'cassonetti')     return 'cassonetto';
  return pt;
}
  // --- Permessi (delete clienti per admin + agenda_all + Giulia/Olga) ---
  function getScopes(u) {
    if (!u) return [];
    if (Array.isArray(u.scopes)) return u.scopes;
    try { return JSON.parse(u.scopes || '[]'); } catch { return []; }
  }
  function canDeleteCustomers(u) {
    if (!u) return false;
    if (u.role === 'admin') return true;
    const scopes = getScopes(u);
    if (scopes.includes('agenda_all')) return true;
    const uname = (u.username || '').toLowerCase();
    return uname === 'giulia' || uname === 'olga';
  }

  /* === Vendor colors (fissi per venditore) === */
  const vendorColorMap = {};

  const VCOLORS = {
    fabio:   { bg:'bg-red-50',   tag:'bg-red-100 text-red-800',     border:'border-red-500' },
    max:     { bg:'bg-green-50', tag:'bg-green-100 text-green-800', border:'border-green-500' },
    narciso: { bg:'bg-sky-50',   tag:'bg-sky-100 text-sky-800',     border:'border-sky-500' },
    sandra:  { bg:'bg-pink-50',  tag:'bg-pink-100 text-pink-800',   border:'border-pink-500' },
    default: { bg:'bg-blue-50',  tag:'bg-blue-100 text-blue-800',   border:'border-blue-500' },
  };

  // 3=fabio, 4=max, 2=narciso (se cambiano gli ID, c'è anche fallback per nome)
  function rebuildVendorColors() {
    vendorColorMap.default = VCOLORS.default;

    vendorColorMap[3] = VCOLORS.fabio;   // Fabio
    vendorColorMap[4] = VCOLORS.max;     // Max
    vendorColorMap[2] = VCOLORS.narciso; // Narciso

    (state.vendors || []).forEach(v => {
      const name = (v.nome_completo || '').toLowerCase();
      if (name.includes('fabio'))   vendorColorMap[v.id] = VCOLORS.fabio;
      if (name.includes('max'))     vendorColorMap[v.id] = VCOLORS.max;
      if (name.includes('narciso')) vendorColorMap[v.id] = VCOLORS.narciso;
	  if (name.includes('sandra'))  vendorColorMap[v.id] = VCOLORS.sandra; // <--- NUOVO
    });
  }

  function vendorDivClasses(appt) {
    const name = (appt.venditore || '').toLowerCase();
    if (name.includes('fabio'))   return `border-l-4 ${VCOLORS.fabio.border} ${VCOLORS.fabio.bg}`;
    if (name.includes('max'))     return `border-l-4 ${VCOLORS.max.border} ${VCOLORS.max.bg}`;
    if (name.includes('narciso')) return `border-l-4 ${VCOLORS.narciso.border} ${VCOLORS.narciso.bg}`;
    if (name.includes('sandra'))  return `border-l-4 ${VCOLORS.sandra.border} ${VCOLORS.sandra.bg}`; // NEW
    
	const c = vendorColorMap[appt.user_id] || VCOLORS.default;
    return `border-l-4 ${c.border} ${c.bg}`;
  }

  function vBg(uid){ return (vendorColorMap[uid] || vendorColorMap.default).bg; }
  function vTag(uid){ return (vendorColorMap[uid] || vendorColorMap.default).tag; }
  function vBorder(uid){ return (vendorColorMap[uid] || vendorColorMap.default).border; }


  function notify(msg, type='info') {
    const colors = {
      info: 'bg-blue-500',
      success: 'bg-green-500',
      warn: 'bg-yellow-500',
      error: 'bg-red-500'
    };
    const box = el('div', { class: `fixed top-4 right-4 text-white px-4 py-3 rounded shadow-lg ${colors[type] || colors.info} z-50` }, msg);
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 3000);
  }

  function confirmBox(message) {
    return new Promise((resolve) => {
      const overlay = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
      const card = el('div', { class: 'bg-white p-6 rounded-lg max-w-sm w-full shadow-xl' }, `
        <h3 class="text-lg font-semibold mb-3">Conferma</h3>
        <p class="text-gray-700 mb-6">${message}</p>
        <div class="flex gap-2 justify-end">
          <button class="px-4 py-2 border rounded" id="canc">Annulla</button>
          <button class="px-4 py-2 bg-red-500 text-white rounded" id="ok">Conferma</button>
        </div>
      `);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      $('#canc', overlay).addEventListener('click', () => { overlay.remove(); resolve(false); });
      $('#ok', overlay).addEventListener('click', () => { overlay.remove(); resolve(true); });
    });
  }

  function setHeadersForUser(user) {
    axios.defaults.headers['user-id'] = user?.id ?? '';
    axios.defaults.headers['user-role'] = user?.role ?? '';
  }

  async function api(method, url, data) {
    try {
      const res = await axios({ method, url, data });
      if (res.data?.error) throw new Error(res.data.error);
      return res.data;
    } catch (e) {
      console.error('API error', method, url, e);
      notify(e?.response?.data?.error || e.message || 'Errore richiesta', 'error');
      throw e;
    }
  }

  /* -------------------- Global State & Router -------------------- */
  const state = {
    user: null,
    view: 'dashboard',
    params: {},
    vendors: [] // Lista venditori caricata una volta
  };
// Variabili globali paginazione e filtri clienti
  let customersCurrentPage = 1;
  let customersTotalPages = 1;
  let customersTotal = 0;
  let customersFilters = {
    search: '',
    stato: '',
    provincia: '',
    data_da: '',
    data_a: ''
  };
  function saveSession() {
    localStorage.setItem('unica_user', JSON.stringify(state.user || null));
  }
  function loadSession() {
    try {
      const raw = localStorage.getItem('unica_user');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function goto(view, params = {}) {
    state.view = view;
    state.params = params || {};
    renderMain();
  }

  /* -------------------- Load Vendors -------------------- */
  async function loadVendors() {
  try {
    //  CACHE LOCALE: Controlla se esiste cache valida (24h)
    const cached = localStorage.getItem('vendors_cache')
    const cacheTime = localStorage.getItem('vendors_cache_time')
    
    if (cached && cacheTime) {
      const age = Date.now() - parseInt(cacheTime)
      const MAX_AGE = 24 * 60 * 60 * 1000 // 24 ore in millisecondi
      
      if (age < MAX_AGE) {
        // ✅ Cache valida, usala
        state.vendors = JSON.parse(cached)
        console.log('✅ Vendors caricati da cache locale (' + state.vendors.length + ' venditori)')
        return
      } else {
        console.log('⏰ Cache vendors scaduta, ricarico da server...')
      }
    }
    
    //  Cache assente o scaduta: carica da server
    const { vendors } = await api('get', '/api/vendors');
    
    // Tieni solo i 3 richiesti, nell'ordine Fabio, Max, Narciso
    const allowed = (vendors || []).filter(v =>
      ['fabio','max','narciso'].includes((v.username || '').toLowerCase())
    ).sort((a,b) => {
      const order = { fabio:1, max:2, narciso:3, sandra:4 };
      const av = order[(a.username||'').toLowerCase()] || 99;
      const bv = order[(b.username||'').toLowerCase()] || 99;
      return av - bv;
    });
    
    state.vendors = allowed;
    
    // 💾 Salva in cache con timestamp
    localStorage.setItem('vendors_cache', JSON.stringify(allowed))
    localStorage.setItem('vendors_cache_time', Date.now().toString())
    console.log('✅ Vendors caricati da server e salvati in cache (' + allowed.length + ' venditori)')
    
  } catch (e) {
    console.error('Error loading vendors:', e);
    
    // 🆘 Fallback: usa cache anche se scaduta piuttosto che non avere dati
    const cached = localStorage.getItem('vendors_cache')
    if (cached) {
      state.vendors = JSON.parse(cached)
      console.warn('⚠️ Usando cache scaduta come fallback (' + state.vendors.length + ' venditori)')
    } else {
      state.vendors = [];
    }
  }
}


  /* -------------------- App Shell -------------------- */
  async function renderLogin() {
    $('#app').innerHTML = `
      <div class="min-h-screen flex items-center justify-center">
        <div class="bg-white p-8 rounded-lg shadow-2xl w-full max-w-md">
          <h2 class="text-2xl font-bold mb-6 text-center">Accedi a <span class="text-blue-600">UNICA CRM</span></h2>
          <form id="loginForm" class="space-y-4">
            <div>
              <label class="block text-sm text-gray-600 mb-1">Username</label>
              <input class="w-full p-3 border rounded" name="username" required />
            </div>
            <div>
              <label class="block text-sm text-gray-600 mb-1">Password</label>
              <input type="password" class="w-full p-3 border rounded" name="password" required />
            </div>
            <button type="submit" class="w-full py-3 bg-blue-500 text-white rounded hover:shadow-lg">Entra</button>
          </form>
        </div>
      </div>
    `;
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const username = fd.get('username');
      const password = fd.get('password');
      const { user } = await api('post', '/api/auth/login', { username, password });
      state.user = user;
      setHeadersForUser(user);
       saveSession();
      await loadVendors(); // Carica venditori dopo login
      // startReminderSystem(user); // 
      renderShell();
    });
  }

  function renderShell() {
    $('#app').innerHTML = `
  <div class="flex flex-col lg:flex-row min-h-screen">
 <!-- Sidebar Mobile (menu collassabile) -->
    <aside id="sidebar" class="fixed lg:static inset-y-0 left-0 z-50 bg-gray-800 text-white w-64 p-3 lg:p-5 transform -translate-x-full lg:translate-x-0 transition-transform duration-300 overflow-y-auto">
      <div class="flex justify-between items-center mb-3 lg:mb-6">
        <h1 class="text-lg lg:text-xl font-bold">UNICA CRM</h1>
        <button id="closeSidebar" class="lg:hidden text-white text-2xl">&times;</button>
      </div>
      
      <nav class="flex lg:flex-col lg:space-y-1 gap-2 lg:gap-0 overflow-x-auto pb-2 lg:pb-0">
  ${navLink('dashboard', 'fas fa-chart-line', 'Dashboard')}
  ${navLink('customers', 'fas fa-users', 'Clienti')}
  ${navLink('appointments', 'fas fa-calendar-alt', 'Agenda')}
  ${navLink('preventivi', 'fas fa-file-invoice', 'Preventivi')}
  ${navLink('sales', 'fas fa-euro-sign', 'Vendite')}
  ${(state.user?.role === 'admin' || (Array.isArray(state.user?.scopes) && state.user.scopes.includes('rilievi'))) ? navLink('rilievi', 'fas fa-ruler-combined', 'Rilievi') : ''}
  ${(state.user?.role === 'admin' || (Array.isArray(state.user?.scopes) && state.user.scopes.includes('orders'))) ? navLink('orders', 'fas fa-shopping-cart', 'Gestione ordini') : ''}
   ${(state.user?.role === 'admin' || (Array.isArray(state.user?.scopes) && state.user.scopes.includes('montaggi'))) ? navLink('montaggi', 'fas fa-tools', 'Montaggi') : ''}
  ${state.user?.role === 'admin' ? navLink('pratiche-enea', 'fas fa-file-invoice', 'Pratiche ENEA') : ''}
  ${navLink('promemoria', 'fas fa-bell', 'Promemoria')}
  ${(state.user?.role === 'admin' || state.user?.role === 'venditore') ? navLink('recalls', 'fas fa-phone', 'Recall') : ''}
  ${state.user?.role === 'admin' ? navLink('reports', 'fas fa-chart-bar', 'Report Economici') : ''}
  ${state.user?.role === 'admin' ? navLink('products', 'fas fa-box', 'Prodotti') : ''}
  ${state.user?.role === 'admin' ? navLink('users', 'fas fa-user-cog', 'Utenti') : ''}
  ${state.user?.role === 'admin' ? navLink('import', 'fas fa-file-import', 'Import Excel') : ''}
  ${state.user?.role === 'admin' ? navLink('audit', 'fas fa-history', 'Attività') : ''}
  ${(state.user?.role === 'admin' || (Array.isArray(state.user?.scopes) && state.user.scopes.includes('presenze'))) ? navLink('presenze', 'fas fa-clock', 'Presenze') : ''}
</nav>
        </aside>

        <!-- Main -->
      <div class="flex-1 flex flex-col min-w-0">
        <header class="bg-white px-4 lg:px-6 py-3 lg:py-4 flex justify-between items-center border-b sticky top-0 z-30">
          <div class="flex items-center gap-3">
            <button id="menuToggle" class="lg:hidden text-gray-700 text-2xl">
              <i class="fas fa-bars"></i>
            </button>
            <div class="font-semibold text-sm lg:text-base truncate">
              <span class="hidden sm:inline">Benvenuto, </span>
              <span class="truncate">${state.user?.nome_completo || state.user?.username}</span>
            </div>
          </div>
            <div class="flex items-center gap-3">
              <span class="text-sm text-gray-600 px-3 py-1 bg-gray-100 rounded">${state.user?.role}</span>
              <button id="logoutBtn" class="px-3 py-2 border rounded">Logout</button>
            </div>
          </header>
          <main id="main" class="p-6 space-y-6"></main>
        </div>
      </div>
    `;

    // 📱 Mobile menu toggle
    const sidebar = $('#sidebar');
    const menuToggle = $('#menuToggle');
    const closeSidebar = $('#closeSidebar');
    const overlay = el('div', { 
      id: 'sidebarOverlay',
      class: 'fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden hidden'
    });
    
    document.body.appendChild(overlay);
    
    // Apri menu
    menuToggle.addEventListener('click', () => {
      sidebar.classList.remove('-translate-x-full');
      overlay.classList.remove('hidden');
      document.body.style.overflow = 'hidden'; // Blocca scroll
    });
    
    // Chiudi menu
    const closeMenu = () => {
      sidebar.classList.add('-translate-x-full');
      overlay.classList.add('hidden');
      document.body.style.overflow = ''; // Ripristina scroll
    };
    
    closeSidebar.addEventListener('click', closeMenu);
    overlay.addEventListener('click', closeMenu);

    $$('.navlink').forEach(a => a.addEventListener('click', (e) => {
      e.preventDefault();
      goto(a.dataset.view);
    }));

    $('#logoutBtn').addEventListener('click', async () => {
      try { await api('post', '/api/auth/logout', { user_id: state.user?.id }); } catch {}
      // stopReminderSystem(); // 🛑 Ferma promemoria (funzione non implementata)
      state.user = null;
      saveSession();
      setHeadersForUser(null);
      renderLogin();
    });

    renderMain();
	// Mostra timbratura dopo che la shell è pronta
    setTimeout(() => {
      if (typeof mostraTimbraturaEntrata === 'function') mostraTimbraturaEntrata();
      if (typeof aggiornaStatoPresenza === 'function') aggiornaStatoPresenza();
    }, 100);
  }

  function navLink(view, icon, label) {
  const active = state.view === view ? 'bg-gray-700' : '';
  return `<a href="#" data-view="${view}" class="navlink flex-shrink-0 lg:block px-3 py-2 rounded lg:rounded-none ${active} whitespace-nowrap">
    <i class="${icon} lg:mr-2"></i> 
    <span class="hidden lg:inline ml-2 lg:ml-0">${label}</span>
  </a>`;
}

  /* -------------------- Views -------------------- */
  async function renderMain() {
    const main = $('#main');
    if (!main) return;

    // Evidenzia voce di menu attiva
    $$('.navlink').forEach(a => {
      a.classList.toggle('bg-gray-700', a.dataset.view === state.view);
    });

     switch (state.view) {
      case 'dashboard': return renderDashboard();
      case 'customers': return renderCustomers();
      case 'appointments': return renderAppointments();
      case 'sales': return renderSales();
      case 'recalls': return renderRecalls();
	  case 'preventivi': return renderPreventivi();
	  case 'rilievi': return renderRilievi();
      case 'orders': return renderOrders();
      case 'montaggi': return renderMontaggi();
      case 'pratiche-enea': return renderPraticheEnea();
      case 'promemoria': return renderPromemoria();
      case 'reports': return renderReports();
      case 'products': return renderProducts();
      case 'users': return renderUsers();
      case 'import': return renderImport();
	  case 'audit': return renderAudit();
	  case 'presenze': return renderPresenze();
      default: return renderDashboard();
    }
  }

  /* ---------- Dashboard ---------- */
  async function renderDashboard() {
    const main = $('#main');
    main.innerHTML = `
      <div class="grid md:grid-cols-4 gap-4">
        <div class="bg-white rounded-lg shadow p-6">
          <div class="flex items-center">
            <div class="flex-shrink-0 p-3 rounded text-white bg-blue-500"><i class="fas fa-users"></i></div>
            <div class="ml-4">
              <div class="text-gray-500 text-sm">Clienti</div>
              <div id="d_total_customers" class="text-2xl font-bold">-</div>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-lg shadow p-6">
          <div class="flex items-center">
            <div class="flex-shrink-0 p-3 rounded text-white bg-green-500"><i class="fas fa-euro-sign"></i></div>
            <div class="ml-4">
              <div class="text-gray-500 text-sm">Fatturato</div>
              <div id="d_total_revenue" class="text-2xl font-bold">-</div>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-lg shadow p-6">
          <div class="flex items-center">
            <div class="flex-shrink-0 p-3 rounded text-white bg-purple-500"><i class="fas fa-box"></i></div>
            <div class="ml-4">
              <div class="text-gray-500 text-sm">Ricevuti</div>
              <div id="d_total_products" class="text-2xl font-bold">-</div>
            </div>
          </div>
        </div>
        <div class="bg-white rounded-lg shadow p-6">
          <div class="flex items-center">
            <div class="flex-shrink-0 p-3 rounded text-white bg-orange-500"><i class="fas fa-bell"></i></div>
            <div class="ml-4">
              <div class="text-gray-500 text-sm">Promemoria attivi</div>
              <div id="d_promemoria" class="text-2xl font-bold">-</div>
            </div>
          </div>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold mb-4">Andamento vendite (ultimi 6 mesi)</h3>
        <canvas id="salesChart" height="80"></canvas>
      </div>
    `;

    const { stats } = await api('get', '/api/dashboard/stats');
    $('#d_total_customers').textContent = stats.total_customers;
    $('#d_total_revenue').textContent = euro(stats.total_revenue);
    $('#d_total_products').textContent = stats.total_products ?? '-';
    $('#d_promemoria').textContent = stats.promemoria_attivi ?? '-';

    const { charts } = await api('get', '/api/dashboard/charts');
    const labels = (charts.sales_by_month || []).map(r => r.month);
    const counts = (charts.sales_by_month || []).map(r => r.count);
    const revenues = (charts.sales_by_month || []).map(r => r.revenue);

    const ctx = $('#salesChart').getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'N. vendite', data: counts, backgroundColor: 'rgba(59, 130, 246, 0.5)' },
          { label: 'Fatturato', data: revenues, backgroundColor: 'rgba(16, 185, 129, 0.5)' }
        ]
      },
      options: { responsive: true, scales: { y: { beginAtZero: true } } }
    });
  }

  /* ---------- Clienti ---------- */
  async function renderCustomers() {
    const main = $('#main');
    main.innerHTML = `
    <div class="flex justify-between items-center">
  <h2 class="text-xl font-semibold">Clienti</h2>
  <div class="flex gap-2">
    <input id="c_search" class="p-2 border rounded" placeholder="Cerca generale..." />
    <button id="export_customers" class="px-3 py-2 bg-green-600 text-white rounded" title="Esporta clienti in CSV">
      <i class="fas fa-file-csv mr-1"></i>Export CSV
    </button>
    <button id="export_customers_master" class="px-3 py-2 bg-purple-600 text-white rounded" title="Export completo con tutti i dati">
      <i class="fas fa-database mr-1"></i>Export Master
    </button>
    <button id="c_new" class="px-3 py-2 bg-blue-500 text-white rounded">Nuovo</button>
  </div>
</div>

    <!-- 🆕 FILTRO DATE -->
    <div class="bg-white rounded-lg shadow p-4 mb-4">
      <h3 class="font-semibold mb-3">Filtro per data creazione</h3>
      <div class="flex items-center gap-3">
        <label class="text-sm font-medium text-gray-700">Da:</label>
        <input type="date" id="filter_data_da" class="p-2 border rounded text-sm" />
        
        <label class="text-sm font-medium text-gray-700">A:</label>
        <input type="date" id="filter_data_a" class="p-2 border rounded text-sm" />
        
        <button id="apply_date_filter" class="px-3 py-2 bg-blue-500 text-white rounded text-sm hover:bg-blue-600">
          <i class="fas fa-filter"></i> Applica
        </button>
        
        <button id="clear_date_filter" class="px-3 py-2 bg-gray-400 text-white rounded text-sm hover:bg-gray-500">
          <i class="fas fa-times"></i> Reset
        </button>
      </div>
    </div>

    <!-- Filtri per colonna -->
    <div class="bg-white rounded-lg shadow p-4 mb-4">
      <h3 class="font-semibold mb-3">Filtri per colonna</h3>
      <div class="grid md:grid-cols-3 gap-3">

        <select id="filter_stato" class="p-2 border rounded text-sm">
         <option value="">Tutti gli stati</option>
         <option value="nuovo">nuovo</option>
         <option value="da lavorare">da lavorare</option>
         <option value="in attesa">in attesa</option>
          <option value="richiamare">richiamare</option>
         <option value="non risponde">non risponde</option>
         <option value="agendato con venditore">agendato con venditore</option>
         <option value="agendato interno">agendato interno</option>
         <option value="solo preventivo">solo preventivo</option>
         <option value="contratto firmato">contratto firmato</option>
         <option value="contratto firmato ufficio">contratto firmato ufficio</option>
         <option value="non interessato">non interessato</option>
         <option value="numero inesistente">numero inesistente</option>
        </select>
        <select id="filter_provincia" class="p-2 border rounded text-sm">
          <option value="">Tutte le province</option>
        </select>
        <button id="clear_filters" class="px-3 py-2 bg-gray-500 text-white rounded text-sm">Reset Filtri</button>
      </div>
    </div>  
    <div class="bg-white rounded-lg shadow p-0 overflow-x-auto">
      <table class="min-w-full">
        <thead>
          <tr>
            <th class="px-4 py-3 text-center font-semibold">#</th>
			<th class="px-4 py-3 text-left">Data Creazione</th>
            <th class="px-4 py-3 text-left">Cliente</th>
            <th class="px-4 py-3 text-left">Contatti</th>
            <th class="px-4 py-3 text-left">Città</th>
            <th class="px-4 py-3 text-left">Provincia</th>
            <th class="px-4 py-3 text-left">Stato</th>
            <th class="px-4 py-3 text-left">Promemoria</th>
            <th class="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody id="c_tbody"></tbody>
      </table>
    </div>
	<div id="customers-pagination"></div>
    `;

    
	// Popola combo province con sigla e nome completo
    const provinceMap = {
      'AG': 'Agrigento', 'AL': 'Alessandria', 'AN': 'Ancona', 'AO': 'Aosta', 'AP': 'Ascoli Piceno',
      'AQ': "L'Aquila", 'AR': 'Arezzo', 'AT': 'Asti', 'AV': 'Avellino', 'BA': 'Bari',
      'BG': 'Bergamo', 'BI': 'Biella', 'BL': 'Belluno', 'BN': 'Benevento', 'BO': 'Bologna',
      'BR': 'Brindisi', 'BS': 'Brescia', 'BT': 'Barletta-Andria-Trani', 'BZ': 'Bolzano', 'CA': 'Cagliari',
      'CB': 'Campobasso', 'CE': 'Caserta', 'CH': 'Chieti', 'CL': 'Caltanissetta', 'CN': 'Cuneo',
      'CO': 'Como', 'CR': 'Cremona', 'CS': 'Cosenza', 'CT': 'Catania', 'CZ': 'Catanzaro',
      'EN': 'Enna', 'FC': 'Forlì-Cesena', 'FE': 'Ferrara', 'FG': 'Foggia', 'FI': 'Firenze',
      'FM': 'Fermo', 'FR': 'Frosinone', 'GE': 'Genova', 'GO': 'Gorizia', 'GR': 'Grosseto',
      'IM': 'Imperia', 'IS': 'Isernia', 'KR': 'Crotone', 'LC': 'Lecco', 'LE': 'Lecce',
      'LI': 'Livorno', 'LO': 'Lodi', 'LT': 'Latina', 'LU': 'Lucca', 'MB': 'Monza e Brianza',
      'MC': 'Macerata', 'ME': 'Messina', 'MI': 'Milano', 'MN': 'Mantova', 'MO': 'Modena',
      'MS': 'Massa-Carrara', 'MT': 'Matera', 'NA': 'Napoli', 'NO': 'Novara', 'NU': 'Nuoro',
      'OR': 'Oristano', 'PA': 'Palermo', 'PC': 'Piacenza', 'PD': 'Padova', 'PE': 'Pescara',
      'PG': 'Perugia', 'PI': 'Pisa', 'PN': 'Pordenone', 'PO': 'Prato', 'PR': 'Parma',
      'PT': 'Pistoia', 'PU': 'Pesaro e Urbino', 'PV': 'Pavia', 'PZ': 'Potenza', 'RA': 'Ravenna',
      'RC': 'Reggio Calabria', 'RE': 'Reggio Emilia', 'RG': 'Ragusa', 'RI': 'Rieti', 'RM': 'Roma',
      'RN': 'Rimini', 'RO': 'Rovigo', 'SA': 'Salerno', 'SI': 'Siena', 'SO': 'Sondrio',
      'SP': 'La Spezia', 'SR': 'Siracusa', 'SS': 'Sassari', 'SU': 'Sud Sardegna', 'SV': 'Savona',
      'TA': 'Taranto', 'TE': 'Teramo', 'TN': 'Trento', 'TO': 'Torino', 'TP': 'Trapani',
      'TR': 'Terni', 'TS': 'Trieste', 'TV': 'Treviso', 'UD': 'Udine', 'VA': 'Varese',
      'VB': 'Verbano-Cusio-Ossola', 'VC': 'Vercelli', 'VE': 'Venezia', 'VI': 'Vicenza', 'VR': 'Verona',
      'VS': 'Medio Campidano', 'VT': 'Viterbo', 'VV': 'Vibo Valentia'
    };
    
    // Crea mappa inversa (nome completo -> sigla)
    const reverseMap = {};
    Object.keys(provinceMap).forEach(sigla => {
      const nome = provinceMap[sigla].toLowerCase();
      reverseMap[nome] = sigla;
    });
    
    // Carica TUTTE le province presenti nel DB (non solo prima pagina)
    const { provinces: provincesFromDb } = await api('get', '/api/customers/provinces');
    const provincesInDb = [...new Set(
      provincesFromDb.map(prov => {
        prov = (prov || '').trim();
        if (!prov) return null;
        
        // Se è una sigla (2 caratteri), restituiscila in maiuscolo
        if (prov.length <= 3) return prov.toUpperCase();
        
        // Se è un nome completo, cerca la sigla corrispondente
        const sigla = reverseMap[prov.toLowerCase()];
        return sigla || prov.toUpperCase();
      }).filter(Boolean)
    )].sort();
    
    const provSel = $('#filter_provincia');
    if (provSel) {
      provSel.innerHTML = `<option value="">Tutte le province</option>` +
        provincesInDb.map(sigla => {
          const nomeCompleto = provinceMap[sigla] || sigla;
          return `<option value="${sigla}">${sigla} - ${nomeCompleto}</option>`;
        }).join('');
    }


    // Carica prima pagina
    await loadCustomersPage(1);


    const applyFilters = async () => {
      customersFilters.search = $('#c_search').value.trim();
      customersFilters.stato = $('#filter_stato').value;
      customersFilters.provincia = $('#filter_provincia').value;
      
      console.log("🔍 Filtri applicati:", customersFilters);
      await loadCustomersPage(1);
    };

    $('#c_search').addEventListener('input', applyFilters);
    $('#filter_stato').addEventListener('change', applyFilters);
    $('#filter_provincia').addEventListener('change', applyFilters);

    $('#clear_filters').addEventListener('click', async () => {
      $('#c_search').value = '';
      $('#filter_stato').value = '';
      $('#filter_provincia').value = '';
      customersFilters = { search: '', stato: '', provincia: '', data_da: '', data_a: '' };
      await loadCustomersPage(1);
    });

    // Filtro date server-side
    $('#apply_date_filter').addEventListener('click', async () => {
      const dataDa = $('#filter_data_da').value;
      const dataA = $('#filter_data_a').value;
      
      if (!dataDa || !dataA) {
        alert('⚠️ Inserisci entrambe le date (Da e A)');
        return;
      }
      
      if (new Date(dataDa) > new Date(dataA)) {
        alert('⚠️ La data "Da" non può essere successiva alla data "A"');
        return;
      }
      
      customersFilters.data_da = dataDa;
      customersFilters.data_a = dataA;
      
      await loadCustomersPage(1);
    });

    $('#clear_date_filter').addEventListener('click', async () => {
      $('#filter_data_da').value = '';
      $('#filter_data_a').value = '';
      customersFilters.data_da = '';
      customersFilters.data_a = '';
      await loadCustomersPage(1);
    });

$('#c_new').addEventListener('click', () => openCustomerModal());

$('#export_customers')?.addEventListener('click', async () => {
  try {
    const response = await fetch('/api/export/customers', {
      headers: {
        'user-id': state.user?.id || '',
        'user-role': state.user?.role || ''
      }
    });

    if (!response.ok) throw new Error('Errore export');

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clienti_export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    notify('Export clienti completato', 'success');
  } catch (error) {
    console.error('Errore export clienti:', error);
    notify('Errore durante l\'export', 'error');
  }
});

$('#export_customers_master')?.addEventListener('click', async () => {
  try {
    notify('Generazione export master in corso...', 'info');

    const response = await fetch('/api/export/customers/master', {
      headers: {
        'user-id': state.user?.id || '',
        'user-role': state.user?.role || ''
      }
    });

    if (!response.ok) throw new Error('Errore export');

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clienti_master_export_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);

    notify('Export master completato', 'success');
  } catch (error) {
    console.error('Errore export master:', error);
    notify('Errore durante l\'export master', 'error');
  }
});

}

  // FUNZIONE: Carica clienti con paginazione e filtri
  async function loadCustomersPage(page = 1) {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', '30');
    
    if (customersFilters.search) params.append('search', customersFilters.search);
    if (customersFilters.stato) params.append('stato', customersFilters.stato);
    if (customersFilters.provincia) params.append('provincia', customersFilters.provincia);
    if (customersFilters.data_da) params.append('data_da', customersFilters.data_da);
    if (customersFilters.data_a) params.append('data_a', customersFilters.data_a);
    
    const response = await api('get', `/api/customers?${params.toString()}`);
    console.log("🌐 API URL:", `/api/customers?${params.toString()}`);
    console.log("📊 Parametri:", Object.fromEntries(params));
    const customers = response.customers || [];
    console.log("📦 Risposta:", response);
    
    if (response.pagination) {
      customersCurrentPage = response.pagination.page;
      customersTotalPages = response.pagination.totalPages;
      customersTotal = response.pagination.total;
      console.log(`✅ Caricati ${customers.length} clienti - Pagina ${customersCurrentPage}/${customersTotalPages} (Totale: ${customersTotal})`);
    }
    
    const tbody = $('#c_tbody');
    if (!tbody) return;
    
    if (customers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="px-4 py-6 text-center text-gray-500">Nessun cliente trovato</td></tr>';
      renderCustomersPagination();
      return;
    }
    
    tbody.innerHTML = customers.map((c, index) => `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3 text-center font-semibold text-gray-600">${((page - 1) * 30) + index + 1}</td>
        <td class="px-4 py-3 text-sm">${fmtDate(c.created_at)}</td>
        <td class="px-4 py-3 font-medium">${c.nome} ${c.cognome}</td>
        <td class="px-4 py-3 text-sm text-gray-600">
          ${c.telefono || ''}<br>${c.email || ''}
        </td>
        <td class="px-4 py-3 text-sm">${c.citta || ''}</td>
        <td class="px-4 py-3 text-sm">${c.provincia || ''}</td>
        <td class="px-4 py-3">
          <span class="px-2 py-1 rounded text-xs ${getStatoBadgeColor(c.stato)}">${c.stato || 'nuovo'}</span>
        </td>
        <td class="px-4 py-3 text-sm">${c.promemoria_scaduti || 0}</td>
        <td class="px-4 py-3 text-right">
          <button class="px-2 py-1 text-blue-600 hover:bg-blue-50 rounded" data-files="${c.id}" title="Allegati">
            <i class="fas fa-paperclip"></i>
          </button>
          <button class="px-2 py-1 border rounded mr-2" data-edit="${c.id}">Modifica</button>
          ${canDeleteCustomers(state.user) ? `<button class="px-2 py-1 bg-red-500 text-white rounded" data-del="${c.id}">Elimina</button>` : ''}
        </td>
      </tr>
    `).join('');

    
    $$('button[data-files]').forEach(b => b.addEventListener('click', () => openFilesModal(b.dataset.files, 'customer')));

    $$('button[data-edit]').forEach(b => b.addEventListener('click', async () => {
      const custId = b.dataset.edit;
      const { customer } = await api('get', `/api/customers/${custId}`);
      openCustomerModal(customer);
    }));

    $$('button[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!canDeleteCustomers(state.user)) {
        notify('Non sei autorizzata a eliminare clienti', 'error');
        return;
      }
      if (await confirmBox('Eliminare definitivamente il cliente e tutti i dati correlati?')) {
        await api('delete', `/api/customers/${b.dataset.del}`);
        notify('Cliente eliminato', 'success');
        renderCustomers();
      }
    }));
    
    renderCustomersPagination();
  }
  
  function renderCustomersPagination() {
    const paginationContainer = document.querySelector('#customers-pagination');
    if (!paginationContainer) return;
    
    if (customersTotalPages <= 1) {
      paginationContainer.innerHTML = '';
      return;
    }

    const prevDisabled = customersCurrentPage <= 1;
    const nextDisabled = customersCurrentPage >= customersTotalPages;

    paginationContainer.innerHTML = `
      <div style="display: flex; justify-content: center; align-items: center; gap: 20px; margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 8px;">
        <button id="btn-prev-customers" ${prevDisabled ? 'disabled' : ''}
          style="padding: 10px 20px; background: ${prevDisabled ? '#ccc' : '#007bff'}; color: white; border: none; border-radius: 5px; cursor: ${prevDisabled ? 'not-allowed' : 'pointer'};">
          ◀ Precedente
        </button>
        <span style="font-weight: bold; font-size: 16px;">
          Pagina ${customersCurrentPage} di ${customersTotalPages}
          <span style="color: #666; font-size: 14px; margin-left: 10px;">(${customersTotal} clienti totali)</span>
        </span>
        <button id="btn-next-customers" ${nextDisabled ? 'disabled' : ''}
          style="padding: 10px 20px; background: ${nextDisabled ? '#ccc' : '#007bff'}; color: white; border: none; border-radius: 5px; cursor: ${nextDisabled ? 'not-allowed' : 'pointer'};">
          Successiva ▶
        </button>
      </div>
    `;

    if (!prevDisabled) {
      document.querySelector('#btn-prev-customers').addEventListener('click', () => {
        loadCustomersPage(customersCurrentPage - 1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
    if (!nextDisabled) {
      document.querySelector('#btn-next-customers').addEventListener('click', () => {
        loadCustomersPage(customersCurrentPage + 1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }
  }
    
  

  function getStatoBadgeColor(stato) {
  const colors = {
    'nuovo': 'bg-gray-100',
    'da lavorare': 'bg-indigo-100 text-indigo-800',
    'in attesa': 'bg-amber-100 text-amber-800',
    'richiamare': 'bg-yellow-100',
    'non risponde': 'bg-orange-100',
    'agendato con venditore': 'bg-blue-100',
    'agendato interno': 'bg-purple-100',
    'solo preventivo': 'bg-cyan-100',
    'contratto firmato': 'bg-green-100',
    'contratto firmato ufficio': 'bg-green-200',
    'non interessato': 'bg-red-100',
    'numero inesistente': 'bg-orange-100'
  };
  return colors[stato] || 'bg-gray-100';
}

  function openCustomerModal(customer = null) {
    const isEdit = !!customer;
    const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
    const card = el('div', { class: 'bg-white p-6 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl' });
    
    card.innerHTML = `
      <h3 class="text-lg font-semibold mb-4">${isEdit ? 'Modifica' : 'Nuovo'} cliente</h3>
      <form id="custForm" class="grid md:grid-cols-2 gap-4">
        <input class="p-2 border rounded" name="nome" placeholder="Nome *" value="${customer?.nome || ''}" required />
        <input class="p-2 border rounded" name="cognome" placeholder="Cognome *" value="${customer?.cognome || ''}" required />
        <input class="p-2 border rounded" name="email" placeholder="Email" value="${customer?.email || ''}" />
        <input class="p-2 border rounded" name="telefono" placeholder="Telefono" value="${customer?.telefono || ''}" />
        <input class="p-2 border rounded" name="azienda" placeholder="Azienda" value="${customer?.azienda || ''}" />
        <input class="p-2 border rounded" name="indirizzo" placeholder="Indirizzo" value="${customer?.indirizzo || ''}" />
        <input class="p-2 border rounded" name="citta" placeholder="Città" value="${customer?.citta || ''}" />
        <input class="p-2 border rounded" name="cap" placeholder="CAP" value="${customer?.cap || ''}" />
        <input class="p-2 border rounded" name="provincia" placeholder="Provincia" value="${customer?.provincia || ''}" />
		 <!-- Dati Fiscali -->
        <input class="p-2 border rounded" name="codice_fiscale" placeholder="Codice Fiscale" value="${customer?.codice_fiscale || ''}" />
        <input class="p-2 border rounded" name="partita_iva" placeholder="Partita IVA" value="${customer?.partita_iva || ''}" />
        <input class="p-2 border rounded" name="codice_sdi" placeholder="Codice SDI" value="${customer?.codice_sdi || ''}" />

<div class="md:col-span-2">
  <label class="block text-sm text-gray-600 mb-1">Note</label>
  <textarea class="p-2 border rounded w-full" name="note" rows="3" placeholder="Note">${customer?.note || ''}</textarea>
</div>
      
    <!-- Cantiere Diverso dall'Indirizzo -->
<div class="md:col-span-2 border rounded p-3 bg-gray-50">
  <label class="flex items-center gap-2 cursor-pointer">
    <input type="checkbox" id="cantiereDiverso" name="cantiere_diverso" ${customer?.cantiere_diverso ? 'checked' : ''} />
    <span class="text-sm font-medium">
      <i class="fas fa-hard-hat mr-1 text-orange-500"></i>Luogo cantiere diverso dall'indirizzo
    </span>
  </label>
  
  <div id="cantiereFields" class="grid md:grid-cols-2 gap-3 mt-3" style="display: ${customer?.cantiere_diverso ? 'grid' : 'none'}">
    <input class="p-2 border rounded" name="cantiere_indirizzo" placeholder="Indirizzo Cantiere" value="${customer?.cantiere_indirizzo || ''}" />
    <input class="p-2 border rounded" name="cantiere_citta" placeholder="Città Cantiere" value="${customer?.cantiere_citta || ''}" />
    <input class="p-2 border rounded" name="cantiere_cap" placeholder="CAP Cantiere" value="${customer?.cantiere_cap || ''}" />
    <input class="p-2 border rounded" name="cantiere_provincia" placeholder="Provincia Cantiere" value="${customer?.cantiere_provincia || ''}" />
  </div>
</div>
  
<div class="md:col-span-2">
  <label class="block text-sm text-gray-600 mb-1">Stato</label>
  <select class="p-2 border rounded w-full" name="stato" id="statoSelect">
   ${['nuovo','da lavorare','in attesa','richiamare','non risponde','agendato con venditore','agendato interno','solo preventivo','contratto firmato','contratto firmato ufficio','non interessato','numero inesistente'].map(s =>
    `<option value="${s}" ${customer?.stato===s?'selected':''}>${s}</option>`
  ).join('')}
</select>
        </div>
        
        <!-- Selezione Venditore (appare solo se stato = agendato con venditore) -->
        <div id="vendorSelectDiv" class="md:col-span-2" style="display: none;">
          <label class="block text-sm text-gray-600 mb-1">Seleziona Venditore</label>
          <select class="p-2 border rounded w-full" name="vendor_id">
            <option value="">-- Seleziona venditore --</option>
            ${state.vendors.map(v => 
              `<option value="${v.id}" ${customer?.assegnato_a == v.id ? 'selected' : ''}>${v.nome_completo}</option>`
            ).join('')}
          </select>
        </div>
        
        <div>
         <label class="block text-sm text-gray-600 mb-1">Data richiamo</label>
         <input class="p-2 border rounded w-full" type="date" name="data_richiamo" value="${customer?.data_richiamo || ''}" />
        </div>
        <div>
         <label class="block text-sm text-gray-600 mb-1">Ora richiamo</label>
         <input class="p-2 border rounded w-full" type="time" name="ora_richiamo" />
        </div>

        <!-- Sezione appuntamento (appare solo per stati "agendato") -->
<div id="appuntamentoSection" class="md:col-span-2 border rounded p-3 bg-blue-50" style="display: none;">
  <label class="block text-sm text-gray-600 mb-2">
    <i class="fas fa-calendar mr-1"></i>Programmazione Appuntamento
  </label>
  <div class="grid grid-cols-2 gap-3">
    <div>
      <label class="block text-xs text-gray-500 mb-1">Data</label>
      <input type="date" class="p-2 border rounded w-full" name="appuntamento_data" />
    </div>
    <div>
      <label class="block text-xs text-gray-500 mb-1">Ora</label>
      <input type="time" class="p-2 border rounded w-full" name="appuntamento_ora" />
    </div>
  </div>
</div>

<!-- Sezione contratto firmato (appare solo per stato "contratto firmato") -->
<div id="contrattoFirmatoSection" class="md:col-span-2 border rounded p-4 bg-green-50 border-l-4 border-green-500" style="display: none;">
  <h4 class="font-semibold mb-3">
    <i class="fas fa-file-signature mr-2"></i>Dettagli Contratto Firmato
  </h4>
  
  <div class="grid md:grid-cols-2 gap-3 mb-3">
    <div>
      <label class="block text-sm text-gray-600 mb-1">Numero Contratto (dal preventivatore) *</label>
      <input type="text" class="p-2 border rounded w-full" name="numero_contratto" placeholder="Es: N° 3094" value="${customer?.numero_contratto || ''}" />
      <div class="text-xs text-gray-500 mt-1">Inserisci il numero del contratto dal preventivatore</div>
    </div>
    <div>
      <label class="block text-sm text-gray-600 mb-1">Data firma contratto *</label>
      <input type="date" class="p-2 border rounded w-full" name="data_firma_contratto" value="${customer?.data_firma_contratto || ''}" />
      <div class="text-xs text-gray-500 mt-1">Puoi inserire anche date passate</div>
    </div>
  </div>
  
 <div class="mb-3" id="venditoreFirmaDiv">
    <label class="block text-sm text-gray-600 mb-1">Contratto preso da *</label>
    <select class="p-2 border rounded w-full" name="venditore_firma">
      <option value="">-- Seleziona venditore --</option>
      <option value="max" ${customer?.venditore_firma === 'max' ? 'selected' : ''}>Max</option>
      <option value="fabio" ${customer?.venditore_firma === 'fabio' ? 'selected' : ''}>Fabio</option>
      <option value="narciso" ${customer?.venditore_firma === 'narciso' ? 'selected' : ''}>Narciso</option>
    </select>
  </div>
  
  <div class="mb-3">
    <label class="block text-sm text-gray-600 mb-1">Importo contratto € *</label>
    <input type="number" step="0.01" class="p-2 border rounded w-full" name="importo" placeholder="0.00" value="${customer?.importo_contratto || ''}" />
  </div>
  
  <div>
    <label class="block text-sm text-gray-600 mb-2">Prodotti venduti</label>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
      ${productTypes.map(pt => `
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" name="prodotti_venduti" value="${pt}"> ${productLabel(pt)}
        </label>
      `).join('')}
    </div>
  </div>
</div>

        ${isEdit ? `
        <div class="md:col-span-2 border rounded p-3 bg-gray-50">
          <label class="block text-sm text-gray-600 mb-2">
            <i class="fas fa-paperclip mr-1"></i>Allegati
          </label>
          <div id="attachmentsList" class="mb-2"></div>
          <input type="file" id="fileInput" multiple class="p-2 border rounded w-full" />
          <div class="text-xs text-gray-500 mt-1">Formati supportati: PDF, JPG, PNG, DOC, DOCX (max 5MB per file)</div>
        </div>
        ` : ''}

        <div class="md:col-span-2 flex justify-between gap-2 mt-2">
          ${isEdit ? `
            <button type="button" id="generatePdf" class="px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600">
              <i class="fas fa-file-pdf mr-1"></i>Genera PDF
            </button>
          ` : '<div></div>'}
          <div class="flex gap-2">
            <button type="button" id="close" class="px-3 py-2 border rounded">Annulla</button>
            <button class="px-3 py-2 bg-blue-500 text-white rounded">${isEdit?'Salva':'Crea'}</button>
          </div>
        </div>
      </form>
    `;
    
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    
     // Show/hide sezioni basate su stato
const statoSelect = $('#statoSelect', card);
const vendorDiv = $('#vendorSelectDiv', card);
const appuntamentoSection = $('#appuntamentoSection', card);
const contrattoSection = $('#contrattoFirmatoSection', card);
const venditoreFirmaDiv = $('#venditoreFirmaDiv', card);
let isInitializing = true;

// Gestione checkbox cantiere diverso
const cantiereDiversoCheckbox = $('#cantiereDiverso', card);
const cantiereFields = $('#cantiereFields', card);

if (cantiereDiversoCheckbox && cantiereFields) {
  cantiereDiversoCheckbox.addEventListener('change', () => {
    cantiereFields.style.display = cantiereDiversoCheckbox.checked ? 'grid' : 'none';
  });
}


const checkStato = () => {
  const stato = statoSelect.value;
  
  // Mostra select venditore solo per "agendato con venditore"
  vendorDiv.style.display = stato === 'agendato con venditore' ? 'block' : 'none';
  
  // Mostra sezione appuntamento per stati "agendato"
  const needsAppointment = ['agendato con venditore', 'agendato interno'].includes(stato);
  appuntamentoSection.style.display = needsAppointment ? 'block' : 'none';
  
   // Mostra sezione contratto per "contratto firmato" e "contratto firmato ufficio"
  contrattoSection.style.display = (stato === 'contratto firmato' || stato === 'contratto firmato ufficio') ? 'block' : 'none';
  
  // Mostra campo venditore SOLO per "contratto firmato" (NON per "contratto firmato ufficio")
  if (venditoreFirmaDiv) {
    venditoreFirmaDiv.style.display = stato === 'contratto firmato' ? 'block' : 'none';
  }
  
  
  // Gestione preventivo (codice esistente)
  if (stato === 'solo preventivo' && !isInitializing) {
    if (!customer?.id) {
      notify('Salva prima il cliente per richiedere un preventivo', 'warn');
      statoSelect.value = customer?.stato || 'nuovo';
      return;
    }
    
    const saveAndOpenPreventivo = async () => {
      try {
        const fd = new FormData($('#custForm', card));
        const body = {
          nome: fd.get('nome'),
          cognome: fd.get('cognome'),
          email: fd.get('email') || null,
          telefono: fd.get('telefono') || null,
        azienda: fd.get('azienda') || null,
          indirizzo: fd.get('indirizzo') || null,
          citta: fd.get('citta') || null,
          cap: fd.get('cap') || null,
          provincia: fd.get('provincia') || null,
          codice_fiscale: fd.get('codice_fiscale') || null,
          partita_iva: fd.get('partita_iva') || null,
          codice_sdi: fd.get('codice_sdi') || null,
          cantiere_diverso: fd.get('cantiere_diverso') ? 1 : 0,
          cantiere_indirizzo: fd.get('cantiere_indirizzo') || null,
          cantiere_citta: fd.get('cantiere_citta') || null,
          cantiere_cap: fd.get('cantiere_cap') || null,
          cantiere_provincia: fd.get('cantiere_provincia') || null,
          stato: 'solo preventivo',
          data_richiamo: fd.get('data_richiamo') || null,
          note: fd.get('note') || null,
          ora_richiamo: fd.get('ora_richiamo') || null
        };

        await api('put', `/api/customers/${customer.id}`, body);
        notify('Cliente aggiornato', 'success');
        wrap.remove();
        openNuovaRichiestaModal(customer.id);
        
        if (state.currentView === 'customers') {
          renderCustomers();
        }
      } catch (error) {
        console.error('Errore salvataggio cliente:', error);
        notify('Errore durante il salvataggio', 'error');
        statoSelect.value = customer?.stato || 'nuovo';
      }
    };
    
    saveAndOpenPreventivo();
  }
};

statoSelect.addEventListener('change', () => {
  isInitializing = false;
  checkStato();
});

checkStato();
isInitializing = false;

    // Pre-check prodotti venduti se presenti
    if (customer?.prodotti_venduti) {
      try {
        const prodotti = JSON.parse(customer.prodotti_venduti);

        $$('input[name="prodotti_venduti"]', card).forEach(input => {
          if (prodotti.includes(input.value)) {
            input.checked = true;
          }
        });
      } catch (e) {
        console.error('Errore parsing prodotti_venduti:', e);
      }
    }

    
    // Load existing attachments if editing
    if (isEdit) {
      loadAttachments(customer.id, 'customer', $('#attachmentsList', card));
      $('#fileInput', card).addEventListener('change', async (e) => {
        const files = e.target.files;
        for (const file of files) {
          if (file.size > 5 * 1024 * 1024) {
            notify('File troppo grande: ' + file.name, 'error');
            continue;
          }
          await uploadFile(file, customer.id, 'customer');
        }
        loadAttachments(customer.id, 'customer', $('#attachmentsList', card));
        e.target.value = '';
      });
    }
    
    $('#close', card).addEventListener('click', () => wrap.remove());
	// Genera PDF
    if (isEdit) {
      $('#generatePdf', card)?.addEventListener('click', async () => {
        try {
          // Apri il PDF in una nuova finestra
          const pdfUrl = `/api/customers/${customer.id}/pdf`;
          const newWindow = window.open(pdfUrl, '_blank');
          
          if (!newWindow) {
            notify('Abilita i popup per generare il PDF', 'warn');
          } else {
            // Aspetta che la pagina si carichi e poi stampa
            setTimeout(() => {
              newWindow.print();
            }, 1000);
          }
        } catch (error) {
          console.error('Errore generazione PDF:', error);
          notify('Errore generazione PDF', 'error');
        }
      });
    }
    $('#custForm', card).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = {
        nome: fd.get('nome'),
        cognome: fd.get('cognome'),
        email: fd.get('email') || null,
        telefono: fd.get('telefono') || null,
        azienda: fd.get('azienda') || null,
        indirizzo: fd.get('indirizzo') || null,
        citta: fd.get('citta') || null,
        cap: fd.get('cap') || null,
         provincia: fd.get('provincia') || null,
        codice_fiscale: fd.get('codice_fiscale') || null,
        partita_iva: fd.get('partita_iva') || null,
        codice_sdi: fd.get('codice_sdi') || null,
        cantiere_diverso: fd.get('cantiere_diverso') ? 1 : 0,
        cantiere_indirizzo: fd.get('cantiere_indirizzo') || null,
        cantiere_citta: fd.get('cantiere_citta') || null,
        cantiere_cap: fd.get('cantiere_cap') || null,
        cantiere_provincia: fd.get('cantiere_provincia') || null,
        stato: fd.get('stato'),
        data_richiamo: fd.get('data_richiamo') || null,
        data_nascita: fd.get('data_nascita') || null,
        note: fd.get('note') || null
      };
      body.ora_richiamo = fd.get('ora_richiamo') || null;
      
      if (body.stato === 'agendato con venditore') {
        body.vendor_id = fd.get('vendor_id') || null;
      }
      
     //  Campi contratto firmato
if (fd.get('numero_contratto')) {
  body.numero_contratto = fd.get('numero_contratto');
}

if (fd.get('data_firma_contratto')) {
  body.data_firma_contratto = fd.get('data_firma_contratto');
}

if (fd.get('venditore_firma')) {
  body.venditore_firma = fd.get('venditore_firma');
}

const importo = Number(fd.get('importo') || 0);
if (importo > 0) {
  body.importo = importo;
  body.importo_contratto = importo; // Salva anche come importo_contratto
}

const prodotti_venduti = $$('input[name="prodotti_venduti"]:checked', card).map(i => i.value);
if (prodotti_venduti.length) body.prodotti_venduti = JSON.stringify(prodotti_venduti.map(apiProductType));
      
      if (fd.get('appuntamento_data') && fd.get('appuntamento_ora')) {
        body.appuntamento_data = fd.get('appuntamento_data');
        body.appuntamento_ora = fd.get('appuntamento_ora');
      }

      if (isEdit) {
        await api('put', `/api/customers/${customer.id}`, body);
        notify('Cliente aggiornato', 'success');
      } else {
        await api('post', '/api/customers', body);
        notify('Cliente creato', 'success');
      }
      wrap.remove();
      renderCustomers();
    });
  }

// === Click su cliente nella tabella Vendite: apre la scheda cliente ===
if (!window.__bindSaleCustomerClick) {
  window.__bindSaleCustomerClick = true;
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('.js-sale-customer');
    if (!a) return;
    e.preventDefault();
    const id = a.getAttribute('data-customer-id');
    if (!id) return;

    try {
      const { customer } = await api('get', `/api/customers/${id}`);
      // apri la modale cliente già esistente
      openCustomerModal(customer);
    } catch (err) {
      console.error('Errore apertura cliente da Vendite', err);
      notify('Impossibile aprire il cliente', 'error');
    }
  });
}

  /* ---------- Appuntamenti (Agenda con Calendario) ---------- */
  function parseApptDT(s) {
  if (!s) return null;
  const str = String(s);

  // Se la stringa termina con 'Z' è UTC. Senza plugin utc,
  // convertiamo usando il Date nativo (che rende l'oggetto in locale).
  if (str.endsWith('Z')) {
    return dayjs(new Date(str));
  }
  // Altrimenti è già locale o senza timezone: parse diretto
  return dayjs(str);
}             
  async function renderAppointments() {
    const main = $('#main');
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
   main.innerHTML = `
  <div class="mb-4">
    <h2 class="text-xl font-semibold mb-3">Agenda</h2>
     <div class="flex flex-wrap gap-2 items-center">
      <select id="monthFilter" class="p-2 border rounded">
        <option value="">Tutti i mesi</option>
        <option value="0">Gennaio</option>
        <option value="1">Febbraio</option>
        <option value="2">Marzo</option>
        <option value="3">Aprile</option>
        <option value="4">Maggio</option>
        <option value="5">Giugno</option>
        <option value="6">Luglio</option>
        <option value="7">Agosto</option>
        <option value="8">Settembre</option>
        <option value="9">Ottobre</option>
        <option value="10">Novembre</option>
        <option value="11">Dicembre</option>
      </select>
      ${state.user?.role === 'admin' ? `
  <select id="vendorFilter" class="p-2 border rounded">
    <option value="">Tutti i venditori</option>
    <option value="fabio">Fabio</option>
	<option value="sandra">Sandra</option>
    <option value="max">Max</option>
    <option value="narciso">Narciso</option>
    <option value="interni">Appuntamenti interni</option>
  </select>
` : ''}

          <input id="apptSearch" class="p-2 border rounded w-full sm:w-auto flex-1 sm:flex-initial text-sm" placeholder="Cerca..." />
            <button id="viewToggle" class="px-3 py-2 border rounded text-sm whitespace-nowrap">
            <i class="fas fa-calendar-alt"></i> Vista Calendario
          </button>
          <button id="a_new" class="px-3 py-2 bg-blue-500 text-white rounded">
            <i class="fas fa-plus"></i> Nuovo appuntamento
          </button>
        </div>
      </div>

      <div id="calendarView" style="display: none;">
        <div class="bg-white rounded-lg shadow p-4">
          <div class="flex justify-between items-center mb-4">
            <button id="prevMonth" class="px-3 py-1 border rounded"><i class="fas fa-chevron-left"></i></button>
            <h3 id="monthYear" class="text-lg font-semibold"></h3>
            <button id="nextMonth" class="px-3 py-1 border rounded"><i class="fas fa-chevron-right"></i></button>
          </div>
          <div id="calendar"></div>
        </div>
      </div>
      
      <div id="listView">
        <div id="a_list" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3"></div>
      </div>
    `;

    let viewMode = 'list';
    let selectedMonth = currentMonth;
    let selectedYear = currentYear;
    let appointmentsAll = [];
    let appointments = [];

    // colori venditore
    let vendorColors = {};
    function rebuildVendorColors() {
      vendorColors = {};
      (state.vendors || []).forEach(v => {
        const n = (v.nome_completo || v.username || '').toLowerCase();
        vendorColors[v.id] =
          n.includes('fabio')   ? 'bg-red-100 text-red-800'    :
          n.includes('max')     ? 'bg-green-100 text-green-800':
          n.includes('narciso') ? 'bg-blue-100 text-blue-800'  :
                                  'bg-indigo-100 text-indigo-800';
      });
    }
    function getVendorColor(appt) {
      return vendorColors[appt.user_id] || 'bg-gray-100 text-gray-800';
    }

 const applyApptFilters = () => {
  const q = ($('#apptSearch')?.value || '').toLowerCase().trim();
  const monthSel = $('#monthFilter')?.value;
  const vendorSel = ($('#vendorFilter')?.value || '').toLowerCase().trim();
  let arr = appointmentsAll.slice();

  // Filtro mese
  if (monthSel !== '' && monthSel !== null) {
    const selectedMonth = parseInt(monthSel);
    arr = arr.filter(a => {
      const d = new Date(a.data_ora);
      return d.getMonth() === selectedMonth;
    });
  }

  // ricerca libera
  if (q) {
    arr = arr.filter(a => {
      const testo = [
        a.cliente || '',
        a.titolo || '',
        a.descrizione || '',
        a.venditore || ''
      ].join(' ').toLowerCase();
      return testo.includes(q);
    });
  }

  // filtro venditore (solo admin)
  if (state.user?.role === 'admin' && vendorSel) {
    const isFabio   = a => String(a.user_id) === '3' || (a.venditore || a.user_name || '').toLowerCase().includes('fabio');
    const isMax     = a => String(a.user_id) === '4' || (a.venditore || a.user_name || '').toLowerCase().includes('max');
    const isNarciso = a => String(a.user_id) === '2' || (a.venditore || a.user_name || '').toLowerCase().includes('narciso');
    const isSandra  = a => (a.venditore || a.user_name || '').toLowerCase().includes('sandra'); // sostituisci con ID se lo hai

    const isInterno = (a) => {
      const vend = (a.venditore || '').toLowerCase();
      const tip  = (a.tipo || a.tipologia || '').toLowerCase();
      return a.is_internal === true
          || a.internal === true
          || vend.includes('intern')
          || tip.includes('intern')
          || (!a.user_id && !vend);
    };

    arr = arr.filter(a => {
      switch (vendorSel) {
        case 'fabio':   return isFabio(a);
        case 'max':     return isMax(a);
        case 'narciso': return isNarciso(a);
        case 'sandra':  return isSandra(a);
        case 'interni': return isInterno(a);
        default:        return true;
      }
    });
  }

  // ordinamento per data
  arr.sort((a, b) => {
    const da = parseApptDT(a.data_ora)?.valueOf?.() || 0;
    const db = parseApptDT(b.data_ora)?.valueOf?.() || 0;
    return da - db;
  });

  appointments = arr;
  updateView();
};

const loadAppointments = async () => {
  //  CARICA TUTTO: Nessun filtro temporale
  let res;
  try {
    // Prova prima senza parametri (carica tutto)
    res = await api('get', '/api/appointments');
  } catch (e) {
    console.error('Errore caricamento appuntamenti:', e);
    res = { appointments: [] };
  }

  appointmentsAll = res.appointments || [];
  appointments = [...appointmentsAll];
  rebuildVendorColors();
  applyApptFilters();
};

    const updateView = () => {
      if (viewMode === 'calendar') {
        renderCalendar();
      } else {
        renderList();
      }
    };
    
    const renderCalendar = () => {
      $('#calendarView').style.display = 'block';
      $('#listView').style.display = 'none';
      $('#viewToggle').innerHTML = '<i class="fas fa-list"></i> Vista Lista';

      const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
      $('#monthYear').textContent = `${monthNames[selectedMonth]} ${selectedYear}`;

      const firstDay = new Date(selectedYear, selectedMonth, 1).getDay();
      const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
      const adjustedFirstDay = firstDay === 0 ? 6 : firstDay - 1;

      let html = `
        <div class="grid grid-cols-7 gap-0 border text-xs sm:text-sm">
          <div class="p-2 bg-gray-100 font-semibold text-center border">Lun</div>
          <div class="p-2 bg-gray-100 font-semibold text-center border">Mar</div>
          <div class="p-2 bg-gray-100 font-semibold text-center border">Mer</div>
          <div class="p-2 bg-gray-100 font-semibold text-center border">Gio</div>
          <div class="p-2 bg-gray-100 font-semibold text-center border">Ven</div>
          <div class="p-2 bg-gray-100 font-semibold text-center border">Sab</div>
          <div class="p-2 bg-gray-100 font-semibold text-center border">Dom</div>
      `;

      for (let i = 0; i < adjustedFirstDay; i++) {
        html += '<div class="border min-h-[100px] p-2 bg-gray-50"></div>';
      }

      for (let day = 1; day <= daysInMonth; day++) {
        const dayAppointments = appointments
          .filter(a => {
            const d = new Date(a.data_ora);
            return d.getDate() === day && d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
          })
          .sort((a, b) => new Date(a.data_ora) - new Date(b.data_ora));

        const isToday =
          day === today.getDate() &&
          selectedMonth === currentMonth &&
          selectedYear === currentYear;

         html += `
           <div class="border min-h-[60px] sm:min-h-[100px] p-1 ${isToday ? 'bg-blue-50 ring-2 ring-blue-500' : ''} hover:bg-gray-50 cursor-pointer">
            <div class="flex items-center justify-between mb-1">
              <div class="font-semibold text-xs sm:text-sm">${day}</div>
              ${dayAppointments.length ? `<span class="text-[8px] sm:text-[10px] px-1 py-0.5 bg-blue-500 text-white rounded">${dayAppointments.length}</span>` : ''}
            </div>

             <!-- Desktop: mostra tutti gli appuntamenti -->
            <div class="space-y-0.5 text-[10px] sm:text-xs max-h-32 overflow-y-auto pr-0.5 hidden sm:block">
              ${dayAppointments.map(a => {
                const apptJson = JSON.stringify(a).replace(/\"/g, '&quot;');
                const tt = (a.titolo || '').replace(/\"/g, '&quot;');
                const hhmm = dayjs(a.data_ora).format('HH:mm');
                const provinciaDisplay = a.provincia ? `<div class="text-xs text-gray-600 truncate">${a.provincia}</div>` : '';
                return `
                  <div class="p-1 rounded cursor-pointer ${vendorDivClasses(a)}"
                       title="${tt}"
                       onclick="window.openAppointmentModal(${apptJson})">
                    <div class="font-semibold truncate">${hhmm} ${a.cliente || ''}</div>
                    ${provinciaDisplay}
                    <div class="truncate">${a.location_display || a.titolo || ''}</div>
                  </div>
                `;
              }).join('')}
            </div>

            <!-- Mobile: mostra primo appuntamento + badge -->
            ${dayAppointments.length > 0 ? `
              <div class="sm:hidden text-[9px] space-y-0.5 touch-manipulation"
                   onclick='window.openDayAppointments(${JSON.stringify({
                     day, 
                     month: selectedMonth, 
                     year: selectedYear, 
                     appointments: dayAppointments
                   }).replace(/'/g, "\\'").replace(/"/g, "&quot;")})'>
                ${(() => {
                  const first = dayAppointments[0];
                  const apptJson = JSON.stringify(first).replace(/\"/g, '&quot;');
                  const hhmm = dayjs(first.data_ora).format('HH:mm');
                  return `
                    <div class="p-1 rounded ${vendorDivClasses(first)} border border-gray-300 active:bg-gray-100">
                      <div class="font-semibold truncate">${hhmm} ${first.cliente || ''}</div>
                      ${first.provincia ? `<div class="truncate text-gray-600">${first.provincia}</div>` : ''}
                    </div>
                  `;
                })()}
                ${dayAppointments.length > 1 ? `
                  <div class="text-center text-blue-600 font-semibold py-0.5 bg-blue-50 rounded border border-blue-200">
                    +${dayAppointments.length - 1} ${dayAppointments.length === 2 ? 'altro' : 'altri'}
                  </div>
                ` : ''}
              </div>
            ` : ''}
          </div>
        `;
      }

      html += '</div>';
      $('#calendar').innerHTML = html;
    };
// 📱 Vista giornaliera mobile (sotto il calendario)
      const mobileAgenda = el('div', { 
        class: 'lg:hidden mt-4 p-4 bg-white rounded-lg shadow'
      });
      
      mobileAgenda.innerHTML = `
        <h3 class="font-semibold mb-3 text-sm">📅 Appuntamenti del mese selezionato</h3>
        <div class="space-y-2 max-h-96 overflow-y-auto">
          ${appointments
            .filter(a => {
              const d = new Date(a.data_ora);
              return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
            })
            .sort((a, b) => new Date(a.data_ora) - new Date(b.data_ora))
            .map(a => {
              const apptJson = JSON.stringify(a).replace(/"/g, '&quot;');
              const dataOra = dayjs(a.data_ora).format('DD/MM HH:mm');
              return `
                <div class="p-3 rounded border ${vendorDivClasses(a)} cursor-pointer"
                     onclick="window.openAppointmentModal(${apptJson})">
                  <div class="flex justify-between items-start mb-1">
                    <div class="font-semibold text-sm">${a.cliente || 'Nessun cliente'}</div>
                    <div class="text-xs text-gray-600">${dataOra}</div>
                  </div>
                  <div class="text-xs text-gray-600">${a.titolo || ''}</div>
                  ${a.provincia ? `<div class="text-xs text-gray-500">${a.provincia}</div>` : ''}
                </div>
              `;
            })
            .join('') || '<div class="text-gray-500 text-sm">Nessun appuntamento questo mese</div>'}
        </div>
      `;
      
      $('#calendar').parentElement.appendChild(mobileAgenda);
    const renderList = () => {
  // mostra lista, nasconde calendario
  $('#calendarView').style.display = 'none';
  $('#listView').style.display = 'block';
  $('#viewToggle').innerHTML = '<i class="fas fa-calendar-alt"></i> Vista Calendario';

  const list = $('#a_list');
  const rows = Array.isArray(appointments) ? appointments.slice() : [];

  if (!rows.length) {
    list.innerHTML = `<div class="bg-white rounded-lg shadow p-6 col-span-2 text-gray-600">
      Nessun appuntamento
    </div>`;
    return;
  }

   // ordina per data: più recenti prima
  rows.sort((a, b) => {
    const da = a?.data_ora ? new Date(a.data_ora).getTime() : 0;
    const db = b?.data_ora ? new Date(b.data_ora).getTime() : 0;
    return db - da; 
  });

  list.innerHTML = rows.map(a => {
    const safe = (v) => (v == null ? '' : String(v));
    const apptJson = JSON.stringify(a || {}).replace(/"/g, '&quot;');
    const statoBadge = getAppointmentColor(a?.stato);
    const titolo = safe(a?.titolo);
    const cliente = safe(a?.cliente);
    const provincia = safe(a?.provincia);
    const tel = safe(a?.customer_telefono);
    const indirizzo = safe(a?.customer_indirizzo);
    const loc = safe(a?.location_display);
    const descr = safe(a?.descrizione || a?.customer_note || a?.descrizione_unificata);
    const dt = a?.data_ora ? fmtDT(a.data_ora) : '';

    return `
      <div class="p-3 lg:p-4 rounded cursor-pointer ${vendorDivClasses(a || {})} touch-manipulation"
           onclick="window.openAppointmentModal(${apptJson})">
        <div class="flex justify-between">
          <div class="font-semibold">${titolo}</div>
          <span class="px-2 py-1 text-xs rounded ${statoBadge}">${safe(a?.stato)}</span>
        </div>
        <div class="text-sm text-gray-600 mt-1">${cliente}</div>
        ${provincia ? `<div class="text-xs text-gray-500">${provincia}</div>` : ''}
        ${indirizzo ? `<div class="text-xs text-gray-500"><i class="fas fa-home mr-1"></i>${indirizzo}</div>` : ''}
        ${loc ? `<div class="text-sm text-gray-500">${loc}</div>` : ''}
        ${dt ? `<div class="text-sm mt-1"><i class="far fa-clock mr-1"></i> ${dt} (${a?.durata_min || 60} min)</div>` : ''}
        ${a?.venditore ? `<div class="text-sm text-gray-500"><i class="fas fa-user mr-1"></i> ${a.venditore}</div>` : ''}
        ${tel ? `<div class="text-sm text-gray-500"><i class="fas fa-phone mr-1"></i> ${tel}</div>` : ''}
        ${descr ? `<div class="text-sm text-gray-700 mt-2">${descr}</div>` : ''}

        ${a?.contratto_chiuso ? `
          <div class="text-sm mt-2 text-green-600">
            <i class="fas fa-check-circle mr-1"></i> Contratto chiuso - ${euro(a?.importo || 0)}
          </div>` : ''}

        <div class="flex gap-2 mt-3">
          <button class="px-2 py-1 text-blue-600 hover:bg-blue-50 rounded" data-files="${a?.id}" data-type="appointment">
            <i class="fas fa-paperclip"></i>
          </button>
          <button class="px-2 py-1 border rounded" data-edit="${encodeURIComponent(JSON.stringify(a || {}))}">Modifica</button>
          <button class="px-2 py-1 bg-red-500 text-white rounded" data-del="${a?.id}">Elimina</button>
        </div>
      </div>
    `;
  }).join('');

  // handlers
  $$('button[data-files]').forEach(b => b.addEventListener('click', () =>
    openFilesModal(b.dataset.files, b.dataset.type)
  ));
  $$('button[data-edit]').forEach(b => b.addEventListener('click', () => {
    const appt = JSON.parse(decodeURIComponent(b.dataset.edit));
    openAppointmentModal(appt);
  }));
  $$('button[data-del]').forEach(b => b.addEventListener('click', async () => {
    if (await confirmBox('Eliminare l\'appuntamento e dati collegati?')) {
      await api('delete', `/api/appointments/${b.dataset.del}`);
      notify('Appuntamento eliminato', 'success');
      await loadAppointments();
	  const monthFilterEl = $('#monthFilter');
if (monthFilterEl) {
  monthFilterEl.value = currentMonth.toString();
  applyApptFilters(); // Applica il filtro
}
    }
  }));
};
    
    const getAppointmentColor = (stato) => {
      const colors = {
        'programmato': 'bg-blue-100 text-blue-800',
        'completato': 'bg-green-100 text-green-800',
        'annullato': 'bg-red-100 text-red-800'
      };
      return colors[stato] || 'bg-gray-100 text-gray-800';
    };
    
 // espongo la funzione per gli onclick inline nel calendario/lista
window.openAppointmentModal = openAppointmentModal;

// listeners
$('#viewToggle').addEventListener('click', () => {
  viewMode = (viewMode === 'list') ? 'calendar' : 'list';
  updateView();
});

$('#prevMonth')?.addEventListener('click', () => {
  selectedMonth--;
  if (selectedMonth < 0) { selectedMonth = 11; selectedYear--; }
  renderCalendar();
});

$('#nextMonth')?.addEventListener('click', () => {
  selectedMonth++;
  if (selectedMonth > 11) { selectedMonth = 0; selectedYear++; }
  renderCalendar();
});

$('#monthFilter')?.addEventListener('change', applyApptFilters);
$('#vendorFilter')?.addEventListener('change', applyApptFilters);
$('#apptSearch')?.addEventListener('input', applyApptFilters);
$('#a_new').addEventListener('click', () => openAppointmentModal());

loadAppointments().then(() => {
  viewMode = 'list';
  updateView();
}).catch(console.error);
} // <-- chiusura di renderAppointments()

  async function openAppointmentModal(appt = null) {
    const { customers } = await api('get', '/api/customers?limit=9999');
    const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
    const card = el('div', { class: 'bg-white p-6 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl' });
    
    card.innerHTML = `
      <h3 class="text-lg font-semibold mb-4">${appt?'Modifica':'Nuovo'} appuntamento</h3>
      <form id="aForm" class="grid md:grid-cols-2 gap-4">
        <select name="customer_id" class="p-2 border rounded md:col-span-2" required>
          <option value="">-- Seleziona cliente --</option>
          ${customers.map(c => `<option value="${c.id}" ${appt && appt.customer_id===c.id?'selected':''}>${c.nome} ${c.cognome}</option>`).join('')}
        </select>
        
        ${state.user?.role === 'admin' ? `
          <select name="user_id" class="p-2 border rounded md:col-span-2">
            <option value="">-- Assegna a venditore --</option>
            ${state.vendors.map(v => `
              <option value="${v.id}" ${appt && appt.user_id == v.id ? 'selected' : ''}>${v.nome_completo}</option>
            `).join('')}
          </select>
        ` : ''}

        <input class="p-2 border rounded md:col-span-2" name="titolo" placeholder="Titolo" value="${appt?.titolo||''}" required />
        <textarea class="p-2 border rounded md:col-span-2" name="descrizione" rows="3" placeholder="Descrizione">${appt?.descrizione||''}</textarea>

        <label class="flex items-center gap-2 md:col-span-2">
          <input type="checkbox" id="ap-sync-note" />
          <span>Scrivi la descrizione anche nelle note del cliente</span>
        </label> 

        <input type="datetime-local" class="p-2 border rounded" name="data_ora" value="${appt? dayjs(appt.data_ora).format('YYYY-MM-DDTHH:mm'):''}" required />
        <input type="number" class="p-2 border rounded" name="durata_min" placeholder="Durata (min)" value="${appt?.durata_min||60}" />
        
        <select class="p-2 border rounded" name="stato" id="statoAppuntamento">
          <option value="programmato" ${appt?.stato==='programmato'?'selected':''}>programmato</option>
          <option value="completato"  ${appt?.stato==='completato'?'selected':''}>completato</option>
          <option value="annullato"   ${appt?.stato==='annullato'?'selected':''}>annullato</option>
        </select>

        <select class="p-2 border rounded md:col-span-2" name="esito_vendita" id="esitoVendita">
          <option value="venduto" ${(!appt || appt?.esito_vendita==='venduto' || !appt?.esito_vendita)?'selected':''}>✅ Venduto</option>
          <option value="non_venduto" ${appt?.esito_vendita==='non_venduto'?'selected':''}>❌ Non venduto (Recall)</option>
        </select>

       
        
        <div id="contrattoSection" class="md:col-span-2 grid gap-3 border rounded p-3 bg-green-50" style="display: none;">
          <div>
            <label class="block text-sm text-gray-600 mb-1">Importo contratto €</label>
            <input type="number" step="0.01" class="p-2 border rounded w-full" name="importo" value="${appt?.importo||''}" />
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1">Prodotti venduti</label>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
              ${productTypes.map(pt => `
                <label class="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="prodotti_venduti" value="${pt}"> ${productLabel(pt)}
                </label>
              `).join('')}
            </div>
          </div>
        </div>
        
        ${appt ? `
        <div class="md:col-span-2 border rounded p-3 bg-gray-50">
          <label class="block text-sm text-gray-600 mb-2">
            <i class="fas fa-paperclip mr-1"></i>Allegati
          </label>
          <div id="attachmentsList" class="mb-2"></div>
          <input type="file" id="fileInput" multiple class="p-2 border rounded w-full" />
          <div class="text-xs text-gray-500 mt-1">Formati supportati: PDF, JPG, PNG, DOC, DOCX (max 5MB per file)</div>
        </div>
        ` : ''}

        <div class="md:col-span-2 flex justify-end gap-2">
          <button type="button" id="close" class="px-3 py-2 border rounded">Annulla</button>
          <button class="px-3 py-2 bg-blue-500 text-white rounded">${appt?'Salva':'Crea'}</button>
        </div>
      </form>
    `;
    
    wrap.appendChild(card);
    document.body.appendChild(wrap);

   // Mostra sezione contratto solo se stato = completato
const contrattoSection = $('#contrattoSection', card);
const statoSelect = $('#statoAppuntamento', card);
const checkContratto = () => {
  const show = statoSelect.value === 'completato';
  contrattoSection.style.display = show ? 'grid' : 'none';
};
statoSelect.addEventListener('change', checkContratto);
checkContratto();

    // Pre-check prodotti_venduti se presenti
    try {
      const pv = appt?.prodotti_venduti ? JSON.parse(appt.prodotti_venduti) : [];
      $$('input[name="prodotti_venduti"]', card).forEach(i => { 
        if (pv.includes(i.value)) i.checked = true; 
      });
    } catch {}

    // Attachments se editing
    if (appt) {
      loadAttachments(appt.id, 'appointment', $('#attachmentsList', card));
      $('#fileInput', card).addEventListener('change', async (e) => {
        const files = e.target.files;
        for (const file of files) {
          if (file.size > 5 * 1024 * 1024) {
            notify('File troppo grande: ' + file.name, 'error');
            continue;
          }
          await uploadFile(file, appt.id, 'appointment');
        }
        loadAttachments(appt.id, 'appointment', $('#attachmentsList', card));
        e.target.value = '';
      });
    }

    $('#close', card).addEventListener('click', () => wrap.remove());
    $('#aForm', card).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const prodotti = $$('input[name="prodotti_venduti"]:checked', card).map(i => i.value);
      const body = {
        customer_id: Number(fd.get('customer_id')),
        titolo: fd.get('titolo'),
        descrizione: fd.get('descrizione') || null,
        data_ora: toISODateTime(fd.get('data_ora')),
        durata_min: Number(fd.get('durata_min') || 60),
        stato: fd.get('stato'),
        esito_vendita: fd.get('esito_vendita') || null,
        contratto_chiuso: fd.get('contratto_chiuso') ? true : false,
        importo: Number(fd.get('importo') || 0),
        prodotti_venduti: prodotti.length ? prodotti.map(apiProductType) : null

      };

      const syncBox = $('#ap-sync-note', card);
      if (syncBox && syncBox.checked) {
        body.sync_note_to_customer = true;
      }

      if (state.user?.role === 'admin' && fd.get('user_id')) {
        body.user_id = Number(fd.get('user_id'));
      }
      
      if (appt) {
        await api('put', `/api/appointments/${appt.id}`, body);
        notify('Appuntamento aggiornato', 'success');
      } else {
        await api('post', `/api/appointments`, body);
        notify('Appuntamento creato', 'success');
      }
      wrap.remove();
      renderAppointments();
    });
  }

  /* ---------- Files Management ---------- */
  async function uploadFile(file, entityId, entityType) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1];
      const body = {
        filename: file.name,
        mime_type: file.type,
        size: file.size,
        data_base64: base64
      };
      
      if (entityType === 'customer') {
        body.customer_id = entityId;
      } else if (entityType === 'appointment') {
        body.appointment_id = entityId;
      }
      
      await api('post', '/api/attachments', body);
      notify('File caricato', 'success');
    };
    reader.readAsDataURL(file);
  }

  async function loadAttachments(entityId, entityType, container) {
    const params = entityType === 'customer' 
      ? `?customer_id=${entityId}` 
      : `?appointment_id=${entityId}`;
    
    try {
      const { attachments } = await api('get', '/api/attachments' + params);
      
      container.innerHTML = attachments.length ? attachments.map(a => `
        <div class="flex items-center justify-between p-2 bg-white border rounded mb-1">
          <div class="flex items-center gap-2">
            <i class="fas fa-file text-gray-500"></i>
            <a href="${a.url}" target="_blank" class="text-blue-600 hover:underline text-sm">${a.filename}</a>
            <span class="text-xs text-gray-500">(${formatFileSize(a.size)})</span>
          </div>
          <button class="text-red-500 hover:bg-red-50 p-1 rounded" data-delete="${a.id}">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      `).join('') : '<div class="text-sm text-gray-500">Nessun allegato</div>';

      $$('button[data-delete]', container).forEach(b => b.addEventListener('click', async () => {
        if (await confirmBox('Eliminare questo allegato?')) {
          await api('delete', `/api/attachments/${b.dataset.delete}`);
          notify('Allegato eliminato', 'success');
          loadAttachments(entityId, entityType, container);
        }
      }));
    } catch (e) {
      container.innerHTML = '<div class="text-sm text-red-500">Errore caricamento allegati</div>';
    }
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB';
    return Math.round(bytes / 1048576) + ' MB';
  }

  function openFilesModal(entityId, entityType) {
    const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
    const card = el('div', { class: 'bg-white p-6 rounded-lg w-full max-w-2xl max-h-[80vh] overflow-y-auto shadow-xl' });
    
    card.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold">Gestione Allegati</h3>
        <button id="closeModal" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times"></i>
        </button>
      </div>
      
      <div class="border rounded p-4 bg-gray-50 mb-4">
        <input type="file" id="fileInput" multiple class="p-2 border rounded w-full mb-2" />
        <div class="text-xs text-gray-500">Formati supportati: PDF, JPG, PNG, DOC, DOCX (max 5MB per file)</div>
      </div>
      
      <div id="attachmentsList"></div>
    `;
    
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    
    loadAttachments(entityId, entityType, $('#attachmentsList', card));
    
    $('#fileInput', card).addEventListener('change', async (e) => {
      const files = e.target.files;
      for (const file of files) {
        if (file.size > 5 * 1024 * 1024) {
          notify('File troppo grande: ' + file.name, 'error');
          continue;
        }
        await uploadFile(file, entityId, entityType);
      }
      loadAttachments(entityId, entityType, $('#attachmentsList', card));
      e.target.value = '';
    });
    
    $('#closeModal', card).addEventListener('click', () => wrap.remove());
  }

  /* ---------- Vendite ---------- */
  async function renderSales() {
    const main = $('#main');
    main.innerHTML = `
      <h2 class="text-xl font-semibold">Vendite</h2>
      <div class="bg-white rounded-lg shadow overflow-x-auto">
        <table class="min-w-full">
          <thead><tr>
            <th class="px-4 py-3 text-left">Ordine</th>
            <th class="px-4 py-3 text-left">Cliente</th>
            <th class="px-4 py-3 text-left">Data</th>
            <th class="px-4 py-3 text-left">Totale</th>
            <th class="px-4 py-3 text-left">Venditore</th>
            <th class="px-4 py-3 text-left">Azioni</th>
          </tr></thead>
          <tbody id="s_tbody"></tbody>
        </table>
      </div>
    `;
    const { sales } = await api('get', '/api/sales');
    $('#s_tbody').innerHTML = (sales||[]).map(s => `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3">${s.numero_ordine}</td>
        <td class="px-4 py-3">
  <a href="#" class="js-sale-customer text-blue-600 hover:underline"
     data-customer-id="${s.customer_id}">
    ${s.customer_nome || ''} ${s.customer_cognome || ''}
  </a>
</td>
        <td class="px-4 py-3">${fmtDate(s.data_vendita)}</td>
        <td class="px-4 py-3 font-semibold">${euro(s.totale)}</td>
        <td class="px-4 py-3">${s.venditore_nome || ''}</td>
        <td class="px-4 py-3">
          <button class="px-2 py-1 bg-red-500 text-white rounded" data-del="${s.id}">Elimina</button>
        </td>
      </tr>
    `).join('');
    
	// 🆕 Handler per modificare vendita

    $$('button[data-edit]').forEach(b => b.addEventListener('click', async () => {
      const saleId = b.dataset.edit;
      const sale = sales.find(s => s.id == saleId);
      if (sale) openEditSaleModal(sale);
    }));
	
    $$('button[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (await confirmBox('Eliminare definitivamente questa vendita?')) {
        await api('delete', `/api/sales/${b.dataset.del}`);
        notify('Vendita eliminata', 'success');
        renderSales();
      }
    }));
  }
  
  /* ---------- Modale Modifica Vendita ---------- */
  async function openEditSaleModal(sale) {
    const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
    const card = el('div', { class: 'bg-white p-6 rounded-lg w-full max-w-md shadow-xl' });
    
    card.innerHTML = `
      <h3 class="text-lg font-semibold mb-4">
        <i class="fas fa-edit mr-2"></i>Modifica Vendita #${sale.id}
      </h3>
      
      <form id="editSaleForm" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1">Cliente</label>
          <input type="text" value="${sale.customer_nome || ''} ${sale.customer_cognome || ''}" 
                 class="p-2 border rounded w-full bg-gray-100" disabled />
        </div>
        
        <div>
          <label class="block text-sm font-medium mb-1">N° Ordine</label>
          <input type="text" value="${sale.numero_ordine || ''}" 
                 class="p-2 border rounded w-full bg-gray-100" disabled />
        </div>
        
        <div>
          <label class="block text-sm font-medium mb-1">Importo</label>
          <input type="text" value="${euro(sale.totale)}" 
                 class="p-2 border rounded w-full bg-gray-100" disabled />
        </div>
        
        <div>
          <label class="block text-sm font-medium mb-1">Data Vendita *</label>
          <input type="date" name="data_vendita" 
                 value="${sale.data_vendita ? dayjs(sale.data_vendita).format('YYYY-MM-DD') : ''}" 
                 class="p-2 border rounded w-full" required />
          <div class="text-xs text-gray-500 mt-1">Puoi inserire anche date passate</div>
        </div>
        
        <div>
          <label class="block text-sm font-medium mb-1">Venditore *</label>
          <select name="user_id" class="p-2 border rounded w-full" required>
            <option value="">-- Seleziona venditore --</option>
            ${state.vendors.map(v => `
              <option value="${v.id}" ${sale.user_id == v.id ? 'selected' : ''}>
                ${v.nome_completo}
              </option>
            `).join('')}
          </select>
        </div>
        
        <div class="flex justify-end gap-2 mt-4">
          <button type="button" id="cancelBtn" class="px-4 py-2 border rounded">Annulla</button>
          <button type="submit" class="px-4 py-2 bg-blue-500 text-white rounded">Salva Modifiche</button>
        </div>
      </form>
    `;
    
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    
    $('#cancelBtn', card).addEventListener('click', () => wrap.remove());
    
    $('#editSaleForm', card).addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      
      const body = {
        data_vendita: fd.get('data_vendita'),
        user_id: Number(fd.get('user_id'))
      };
      
      try {
        await api('put', `/api/sales/${sale.id}`, body);
        notify('Vendita aggiornata con successo', 'success');
        wrap.remove();
        renderSales();
      } catch (error) {
        console.error('Errore aggiornamento vendita:', error);
      }
    });
  }
  
  /* ---------- Gestione ordini ---------- */
  async function renderOrders() {
    const main = $('#main');
     main.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-semibold">Gestione ordini</h2>
        <div class="flex gap-2">
          <button onclick="findDuplicateOrders()" class="px-3 py-2 bg-orange-500 text-white rounded hover:bg-orange-600">
            <i class="fas fa-search mr-2"></i>Trova Doppioni
          </button>
          <button id="o_refresh" class="px-3 py-2 border rounded">Aggiorna</button>
        </div>
      </div>

      <!-- FILTRI RICERCA -->
      <div class="bg-white rounded-lg shadow p-4 mb-4">
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Data Contratto</label>
            <input type="date" id="filter_data" class="w-full px-3 py-2 border rounded">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Nome Cliente</label>
            <input type="text" id="filter_nome" placeholder="Nome o cognome..." class="w-full px-3 py-2 border rounded">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Telefono</label>
            <input type="text" id="filter_telefono" placeholder="Numero telefono..." class="w-full px-3 py-2 border rounded">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">Stato</label>
            <select id="filter_stato" class="w-full px-3 py-2 border rounded">
              <option value="">Tutti (esclusi completati)</option>
              <option value="in_preparazione">In Preparazione</option>
              <option value="da_programmare">Da Programmare</option>
              <option value="completato">Completato</option>
            </select>
          </div>
          <div class="flex items-center">
            <label class="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" id="show_completed" class="w-4 h-4 rounded">
              <span>Mostra completati</span>
            </label>
          </div>
          <div class="flex items-end gap-2">
          <div class="flex items-end gap-2">
            <button id="apply_filters" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition flex-1">
              <i class="fas fa-search mr-1"></i> Cerca
            </button>
            <button id="reset_filters" class="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition">
              <i class="fas fa-undo mr-1"></i> Reset
            </button>
          </div>
        </div>
      </div>

      <div id="o_list" class="grid md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
    `;
    $('#o_refresh').addEventListener('click', renderOrders);

   const { orders: allOrders } = await api('get', '/api/orders');

    // Variabile per ordini filtrati
    let filteredOrders = allOrders;

    // Funzione per applicare i filtri
    function applyFilters() {
      const dataFilter = $('#filter_data')?.value || '';
      const nomeFilter = $('#filter_nome')?.value.toLowerCase().trim() || '';
      const telefonoFilter = $('#filter_telefono')?.value.replace(/\s/g, '') || '';
      const statoFilter = $('#filter_stato')?.value || '';
      const showCompleted = $('#show_completed')?.checked || false;

      filteredOrders = allOrders.filter(order => {
        let match = true;

        // 🔧 Nascondi completati per default (tranne se selezionato esplicitamente o checkbox attivo)
        if (!showCompleted && statoFilter !== 'completato' && order.stato === 'completato') {
          return false;
        }

        // Filtra per data contratto
        if (dataFilter && order.data_contratto) {
          const orderDate = order.data_contratto.split('T')[0]; // Estrai YYYY-MM-DD
          match = match && orderDate === dataFilter;
        }

        // Filtra per nome cliente
        if (nomeFilter) {
          const cliente = (order.cliente || '').toLowerCase();
          match = match && cliente.includes(nomeFilter);
        }

        // Filtra per telefono (rimuove spazi)
        if (telefonoFilter) {
          const telefono = (order.cliente_telefono || '').replace(/\s/g, '');
          match = match && telefono.includes(telefonoFilter);
        }

        // Filtra per stato
        if (statoFilter) {
          match = match && order.stato === statoFilter;
        }

        return match;
      });

      renderOrdersList();
    }

    // Funzione per resettare i filtri
     function resetFilters() {
      $('#filter_data').value = '';
      $('#filter_nome').value = '';
      $('#filter_telefono').value = '';
      $('#filter_stato').value = '';
      filteredOrders = allOrders;
      renderOrdersList();
    }

     // Gestori eventi per i bottoni filtro
    $('#apply_filters').addEventListener('click', applyFilters);
    $('#reset_filters').addEventListener('click', resetFilters);
    $('#show_completed')?.addEventListener('change', applyFilters);

    // Funzione per renderizzare la lista ordini filtrati
    function renderOrdersList() {
      const orders = filteredOrders;
	// Controllo permessi
  const hasOrders = Array.isArray(state.user?.scopes) && state.user.scopes.includes('orders');
  if (state.user?.role !== 'admin' && !hasOrders) {
    main.innerHTML = '<div class="bg-red-50 border border-red-200 rounded p-4 text-red-700">Accesso negato: non hai i permessi per visualizzare gli ordini.</div>';
    return;
  }
    const list = $('#o_list');
    if (!orders?.length) {
      list.innerHTML = `<div class="bg-white rounded-lg shadow p-6 text-gray-600">Nessun ordine</div>`;
      return;
    }

    list.innerHTML = orders.map(o => {
      const items = (o.items || []);
      const hasArrivedItems = items.some(i => i.data_arrivo && i.selezionato);
      const selectedItems = items.filter(i => i.selezionato).length;
      const totalItems = items.length;
      
      return `
        <div class="bg-white rounded-lg shadow p-4 hover:shadow-lg ${hasArrivedItems ? 'border-l-4 border-green-500' : ''}" 
             data-order-id="${o.id}">
          <div class="flex justify-between items-start">
            <div class="flex-1 cursor-pointer">
              <div class="font-semibold text-lg">Ordine #${o.id}</div>
              <div class="text-gray-600">${o.cliente || 'Cliente sconosciuto'}</div>
              <div class="text-sm text-gray-500 mt-1">N° Ordine: ${o.numero_ordine || '-'}</div>
              ${o.data_contratto ? `
                <div class="text-sm text-blue-600 font-medium mt-1">
                  <i class="fas fa-calendar-check mr-1"></i>Contratto: ${fmtDate(o.data_contratto)}
                </div>
              ` : ''}
              ${o.cliente_telefono ? `<div class="text-sm text-gray-500"><i class="fas fa-phone mr-1"></i>${o.cliente_telefono}</div>` : ''}
            </div>
            <div class="text-right">
              <span class="px-2 py-1 rounded text-xs ${
                o.stato === 'completato' ? 'bg-green-100 text-green-800' : 
                o.stato === 'da_programmare' ? 'bg-blue-100 text-blue-800' : 
                'bg-orange-100 text-orange-800'
              }">${o.stato.replace(/_/g, ' ')}</span>
              <div class="mt-2 space-y-1">
                ${items.filter(i => i.selezionato).map(item => `
                  <div class="text-xs flex items-center gap-2 ${item.data_arrivo ? 'text-green-600' : 'text-orange-500'}">
                    ${item.data_arrivo ? '<i class="fas fa-check-circle"></i>' : '<i class="far fa-clock"></i>'}
                    <span>${item.product_type.replace(/_/g, ' ')}</span>
                    ${item.data_arrivo ? `<span class="text-gray-500">(${dayjs(item.data_arrivo).format('DD/MM/YYYY')})</span>` : '<span class="text-gray-500">(in attesa)</span>'}
                  </div>
                `).join('')}
              </div>
              <div class="flex gap-2 mt-2">
                <button class="px-2 py-1 bg-blue-500 text-white rounded text-xs" onclick="openEditOrderModal(${o.id}, event)">
                  <i class="fas fa-edit"></i> Modifica
                </button>
                ${o.stato !== 'completato' ? `
                  <button class="px-2 py-1 bg-green-500 text-white rounded text-xs" data-complete-order="${o.id}">
                    <i class="fas fa-check"></i> Completa
                  </button>
                ` : ''}
                <button class="px-2 py-1 bg-red-500 text-white rounded text-xs" data-del-order="${o.id}">Elimina</button>
              </div>
            </div>
          </div>
          <div class="mt-3 flex justify-between items-center">
            <div class="text-sm text-gray-500">
              ${o.cliente_indirizzo ? `📍 ${o.cliente_indirizzo}` : ''}
              ${o.cliente_citta || o.cliente_provincia ? `<div class="text-sm">${o.cliente_citta || ''}${o.cliente_provincia ? ` (${o.cliente_provincia})` : ''}</div>` : ''}
            </div>
            <div class="text-lg font-semibold text-green-600">
              ${euro(o.importo_vendita || 0)}
            </div>
          </div>
        </div>
      `;
    }).join('');

   // Apri modal ordine

    $$('[data-order-id]').forEach(card => {
      card.addEventListener('click', async (e) => {
        if (e.target.closest('[data-del-order]')) return;
        if (e.target.closest('[data-edit-order]')) return; // Evita conflitto con bottone Modifica
        
        const orderId = card.dataset.orderId;
        
        // 🔧 CORREZIONE: Ricarica l'ordine dal server per avere dati aggiornati
        try {
          const { orders: updatedOrders } = await api('get', '/api/orders');
          const order = updatedOrders.find(o => o.id == orderId);
          if (order) {
            openOrderModal(order);
          } else {
            notify('Ordine non trovato', 'error');
          }
        } catch (error) {
          console.error('Errore caricamento ordine:', error);
          notify('Errore caricamento ordine', 'error');
        }
      });
    });

    // Elimina ordine
    $$('button[data-del-order]').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (await confirmBox('Eliminare definitivamente questo ordine e tutti i dati correlati?')) {
        await api('delete', `/api/orders/${b.dataset.delOrder}`);
        notify('Ordine eliminato', 'success');
        renderOrders();
      }
     }));
	 
	  // Segna ordine come completato

    $$('button[data-complete-order]').forEach(b => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const oid = b.dataset.completeOrder;
      if (!confirm('Segnare questo ordine come completato?')) return;
      
      try {
        await api('put', `/api/orders/${oid}/stato`, { stato: 'completato' });
        notify('Ordine completato', 'success');
        
        // Ricarica ordini
        const { orders: updatedOrders } = await api('get', '/api/orders');
        allOrders.length = 0;
        allOrders.push(...updatedOrders);
        applyFilters();
      } catch (error) {
        notify('Errore durante il completamento', 'error');
        console.error(error);
      }
    }));
    } 

    
    renderOrdersList();

    function openOrderModal(order) {
      const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
      const card = el('div', { class: 'bg-white p-6 rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-xl' });
      
      const hasArrivedItems = (order.items || []).some(i => i.data_arrivo && i.selezionato);
      
      card.innerHTML = `
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-semibold">Gestione Ordine #${order.id}</h3>
          <button id="closeModal" class="text-gray-500 hover:text-gray-700">
            <i class="fas fa-times"></i>
          </button>
        </div>
        
        <div class="mb-4 p-4 bg-gray-50 rounded">
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <div class="font-semibold">${order.cliente}</div>
              <div class="text-sm text-gray-600">${order.cliente_indirizzo || ''}</div>
              ${order.cliente_citta || order.cliente_provincia ? `<div class="text-sm text-gray-600">${order.cliente_citta || ''}${order.cliente_provincia ? ` (${order.cliente_provincia})` : ''}</div>` : ''}
              <div class="text-sm text-gray-600">${order.cliente_telefono || ''}</div>
            </div>
            <div class="text-right">
              <div class="text-sm text-gray-500">N° Ordine: ${order.numero_ordine}</div>
              <div class="text-lg font-semibold text-green-600">${euro(order.importo_vendita || 0)}</div>
              <span class="px-2 py-1 rounded text-xs ${order.stato === 'completato' ? 'bg-green-100' : 'bg-blue-100'}">${order.stato}</span>
            </div>
          </div>
        </div>

        <div class="space-y-4">
          <h4 class="font-semibold mb-3">Prodotti dell'ordine:</h4>
          ${(order.items || []).filter(item => item.selezionato).map(it => {
            const hasArrived = it.selezionato && it.data_arrivo;
            return `
              <div class="border rounded p-4 ${hasArrived ? 'border-green-500 bg-green-50' : 'bg-gray-50'}">
                <div class="flex justify-between items-center mb-3">
                  <div class="font-semibold">${it.product_type.replace('_',' ')}</div>
                  ${hasArrived ? '<span class="text-green-600"><i class="fas fa-check-circle"></i> Arrivato</span>' : ''}
                </div>
                <div class="grid md:grid-cols-2 gap-3 mb-3">
                  <div>
                    <label class="text-xs text-gray-600">Fornitore</label>
                    <input type="text" class="p-2 border rounded w-full" 
                           data-pt="${it.product_type}" data-k="fornitore" value="${it.fornitore || ''}" 
                           placeholder="es. Ditta ABC" />
                  </div>
                  <div>
                    <label class="text-xs text-gray-600">Quantità</label>
                    <input type="number" class="p-2 border rounded w-full" 
                           data-pt="${it.product_type}" data-k="quantita" value="${it.quantita || 1}" 
                           min="1" />
                  </div>
                </div>
                <div class="grid md:grid-cols-3 gap-3">
                  <div>
                    <label class="text-xs text-gray-600">Costo €</label>
                    <input type="number" step="0.01" class="p-2 border rounded w-full" 
                           data-pt="${it.product_type}" data-k="costo" value="${it.costo || 0}" />
                  </div>
                  <div>
                    <label class="text-xs text-gray-600">Data prevista</label>
                    <input type="date" class="p-2 border rounded w-full" 
                           data-pt="${it.product_type}" data-k="data_prevista" value="${it.data_prevista || ''}" />
                  </div>
                  <div>
                    <label class="text-xs text-gray-600">Data arrivo effettiva</label>
                    <input type="date" class="p-2 border rounded w-full ${hasArrived ? 'bg-green-100' : ''}" 
                           data-pt="${it.product_type}" data-k="data_arrivo" value="${it.data_arrivo || ''}" />
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
        
        <div class="flex justify-end gap-2 mt-6">
          <button id="cancelOrder" class="px-4 py-2 border rounded">Annulla</button>
          <button id="saveOrder" class="px-4 py-2 bg-blue-500 text-white rounded">Salva Modifiche</button>
        </div>
      `;
      
      wrap.appendChild(card);
      document.body.appendChild(wrap);
      
      $('#closeModal', card).addEventListener('click', () => wrap.remove());
      $('#cancelOrder', card).addEventListener('click', () => wrap.remove());
      $('#saveOrder', card).addEventListener('click', async () => {
          const data = (order.items || []).filter(item => item.selezionato).map(it => {
          const pt = it.product_type;
          const get = (k) => $(`input[data-pt="${pt}"][data-k="${k}"]`, card);
          return {
            product_type: pt,
            selezionato: true,
            fornitore: get('fornitore')?.value || null,
            quantita: Number(get('quantita')?.value || 1),
            costo: Number(get('costo')?.value || 0),
            data_prevista: get('data_prevista')?.value || null,
            data_arrivo: get('data_arrivo')?.value || null
          };
        });
        
        await api('put', `/api/orders/${order.id}/products`, { products: data });
        notify('Ordine aggiornato', 'success');
        const hasArrivedProducts = data.some(p => p.selezionato && p.data_arrivo);
        if (hasArrivedProducts) notify('Prodotti arrivati - verificare sezione Montaggi', 'info');
        wrap.remove();
        renderOrders();
      });
    }
  }

  /* ---------- Montaggi  ---------- */
async function renderMontaggi() {
  const main = $('#main');
  const today = new Date();
  
  // Controllo permessi
  const hasMontaggi = Array.isArray(state.user?.scopes) && state.user.scopes.includes('montaggi');
  if (state.user?.role !== 'admin' && !hasMontaggi) {
    main.innerHTML = '<div class="bg-red-50 border border-red-200 rounded p-4 text-red-700">Accesso negato: non hai i permessi per visualizzare i montaggi.</div>';
    return;
  }
  
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();
    
  main.innerHTML = `
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-semibold"><i class="fas fa-tools mr-2"></i>Montaggi</h2>
      <div class="flex gap-2">
        <button onclick="openMontaggioExpressModal()" class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition">
          <i class="fas fa-plus mr-2"></i>Montaggio Veloce
        </button>
        <button id="viewToggle" class="px-3 py-2 border rounded">
          <i class="fas fa-calendar-alt"></i> Vista Calendario
        </button>
      </div>
    </div>
    
    <!-- FILTRI RICERCA -->
    <div class="bg-white rounded-lg shadow p-4 mb-4">
      <h3 class="font-semibold mb-3 text-gray-700">
        <i class="fas fa-filter mr-2"></i>Filtri Ricerca
      </h3>
      <div class="grid grid-cols-1 md:grid-cols-5 gap-3">
        <div>
          <label class="block text-sm text-gray-600 mb-1">Stato</label>
          <select id="filter_stato_montaggio" class="p-2 border rounded w-full text-sm">
            <option value="">Tutti gli stati</option>
            <option value="attesa_merci">Attesa Merci</option>
            <option value="da_programmare">Da Programmare</option>
            <option value="programmato">Programmato</option>
            <option value="completato">Completato</option>
            <option value="da_ritornare">Da Ritornare</option>
            <option value="manutenzione">Manutenzione</option>
            <option value="annullato">Annullato</option>
          </select>
        </div>
        <div>
          <label class="block text-sm text-gray-600 mb-1">Numero Preventivo</label>
          <input type="text" id="filter_numero_preventivo" class="p-2 border rounded w-full text-sm" placeholder="es. 2024/001">
        </div>
        <div>
          <label class="block text-sm text-gray-600 mb-1">Nome Cliente</label>
          <input type="text" id="filter_nome_montaggio" class="p-2 border rounded w-full text-sm" placeholder="Nome o cognome...">
        </div>
        <div>
          <label class="block text-sm text-gray-600 mb-1">Telefono</label>
          <input type="text" id="filter_telefono_montaggio" class="p-2 border rounded w-full text-sm" placeholder="Numero telefono...">
        </div>
        <div class="flex items-end gap-2">
          <button id="apply_filters_montaggio" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm flex-1">
            <i class="fas fa-search mr-1"></i>Cerca
          </button>
          <button id="reset_filters_montaggio" class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 text-sm flex-1">
            <i class="fas fa-redo mr-1"></i>Reset
          </button>
        </div>
      </div>
    </div>
    
    <div id="calendarView" style="display: none;">
      <div class="bg-white rounded-lg shadow p-4">
        <div class="flex justify-between items-center mb-4">
          <button id="prevMonth" class="px-3 py-1 border rounded"><i class="fas fa-chevron-left"></i></button>
          <h3 id="monthYear" class="text-lg font-semibold"></h3>
          <button id="nextMonth" class="px-3 py-1 border rounded"><i class="fas fa-chevron-right"></i></button>
        </div>
        <div id="calendar"></div>
      </div>
    </div>
    
    <div id="listView">
      <div id="m_list" class="grid md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
    </div>
  `;

  let viewMode = 'list';
  let selectedMonth = currentMonth;
  let selectedYear = currentYear;
  let montaggiAll = [];
  let appointments = [];
  let montaggiFiltered = [];

 const loadMontaggi = async () => {
    const res = await api('get', '/api/montaggi');
    montaggiAll = res.montaggi || [];
    
    //  Ordina per data contratto (decrescente)
    montaggiAll.sort((a, b) => {
      const dateA = a.data_contratto ? new Date(a.data_contratto).getTime() : 0;
      const dateB = b.data_contratto ? new Date(b.data_contratto).getTime() : 0;
      return dateB - dateA; // decrescente
    });
    
    montaggiFiltered = montaggiAll;
    
    //  Carica appuntamenti dal calendario Agenda (tutto l'anno)
    try {
      const yearStart = `${selectedYear}-01-01`;
      const yearEnd = `${selectedYear}-12-31`;
      const res = await api('get', `/api/appointments?from=${yearStart}&to=${yearEnd}`);
      appointments = res.appointments || [];
      console.log('✅ Appuntamenti caricati:', appointments.length);
    } catch (e) {
      appointments = [];
    }
    updateView();
  };
  
  const applyFilters = () => {
    const statoFilter = $('#filter_stato_montaggio').value;
    const numeroFilter = $('#filter_numero_preventivo').value.toLowerCase().trim();
    const nomeFilter = $('#filter_nome_montaggio').value.toLowerCase().trim();
    const telefonoFilter = $('#filter_telefono_montaggio').value.replace(/\s/g, '').trim();
    
    montaggiFiltered = montaggiAll.filter(m => {
      // Filtro stato
      if (statoFilter && m.stato !== statoFilter) {
        return false;
      }
      
      // Filtro numero contratto
      if (numeroFilter && !m.numero_contratto?.toLowerCase().includes(numeroFilter)) {
        return false;
      }
      
      // Filtro nome cliente
      if (nomeFilter && !m.cliente.toLowerCase().includes(nomeFilter)) {
        return false;
      }
      
      // Filtro telefono
      if (telefonoFilter && !m.cliente_telefono?.replace(/\s/g, '').includes(telefonoFilter)) {
        return false;
      }
      
      return true;
    });
    
    updateView();
  };
  
    const resetFilters = () => {
    $('#filter_stato_montaggio').value = '';
    $('#filter_numero_preventivo').value = '';
    $('#filter_nome_montaggio').value = '';
    $('#filter_telefono_montaggio').value = '';
    montaggiFiltered = montaggiAll;
    updateView();
  };
  const updateView = () => {
    if (viewMode === 'calendar') {
      renderCalendarMontaggi();
    } else {
      renderListMontaggi();
    }
  };

  const renderListMontaggi = () => {
    $('#calendarView').style.display = 'none';
    $('#listView').style.display = 'block';
    $('#viewToggle').innerHTML = '<i class="fas fa-calendar-alt"></i> Vista Calendario';

   const list = $('#m_list');
    if (!montaggiFiltered.length) {
      list.innerHTML = `<div class="bg-white rounded-lg shadow p-6 col-span-3 text-gray-600">Nessun montaggio trovato</div>`;
      return;
    }

    // Raggruppa per stato come nei Rilievi
    const attesaMerci = montaggiFiltered.filter(m => m.stato === 'attesa_merci');
    const daProgrammare = montaggiFiltered.filter(m => m.stato === 'da_programmare');
    const programmati = montaggiFiltered.filter(m => m.stato === 'programmato');
    const completati = montaggiFiltered.filter(m => m.stato === 'completato');
    const daRitornare = montaggiFiltered.filter(m => m.stato === 'da_ritornare');
    const manutenzione = montaggiFiltered.filter(m => m.stato === 'manutenzione');

    list.innerHTML = `
      ${attesaMerci.length ? `
        <div class="col-span-full">
          <h3 class="text-lg font-semibold mb-3 text-red-600">
            <i class="fas fa-truck mr-2"></i>Attesa Merci (${attesaMerci.length})
          </h3>
          <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${attesaMerci.map(renderMontaggioCard).join('')}
          </div>
        </div>
      ` : ''}
      
      ${daProgrammare.length ? `
        <div class="col-span-full ${attesaMerci.length ? 'mt-6' : ''}">
          <h3 class="text-lg font-semibold mb-3 text-orange-600">
            <i class="fas fa-exclamation-circle mr-2"></i>Da Programmare (${daProgrammare.length})
          </h3>
          <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${daProgrammare.map(renderMontaggioCard).join('')}
          </div>
        </div>
      ` : ''}
      
      ${programmati.length ? `
        <div class="col-span-full mt-6">
          <h3 class="text-lg font-semibold mb-3 text-blue-600">
            <i class="fas fa-calendar-check mr-2"></i>Programmati (${programmati.length})
          </h3>
          <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${programmati.map(renderMontaggioCard).join('')}
          </div>
        </div>
      ` : ''}
      
      ${completati.length ? `
        <div class="col-span-full mt-6">
          <h3 class="text-lg font-semibold mb-3 text-green-600">
            <i class="fas fa-check-circle mr-2"></i>Completati (${completati.length})
          </h3>
          <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${completati.map(renderMontaggioCard).join('')}
          </div>
        </div>
      ` : ''}
     ${daRitornare.length ? `
        <div class="col-span-full mt-6">
          <h3 class="text-lg font-semibold mb-3 text-yellow-600">
            <i class="fas fa-undo mr-2"></i>Da Ritornare (${daRitornare.length})
          </h3>
          <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${daRitornare.map(renderMontaggioCard).join('')}
          </div>
        </div>
      ` : ''}
      
      ${manutenzione.length ? `
        <div class="col-span-full mt-6">
          <h3 class="text-lg font-semibold mb-3 text-purple-600">
            <i class="fas fa-tools mr-2"></i>Manutenzione (${manutenzione.length})
          </h3>
          <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            ${manutenzione.map(renderMontaggioCard).join('')}
          </div>
        </div>
      ` : ''}
    `;


    

    // Event handlers

    $$('[data-montaggio-id]').forEach(card => {
      card.addEventListener('click', async () => {
        const id = card.dataset.montaggioId;
        const montaggio = montaggiAll.find(m => m.id == id);
        if (montaggio) openMontaggioModal(montaggio);
      });
    });
  };

  const renderMontaggioCard = (m) => {
    const statoBadge = getMontaggioStatoBadge(m.stato);
    const priorityBorder = getPriorityBorder(m.priorita);
    
    // Mostra tutti i prodotti separati da virgola
    const prodotti = m.prodotti_da_montare 
      ? m.prodotti_da_montare.split(',').map(p => p.replace(/_/g, ' ').trim()).join(', ')
      : 'N/A';
    
    return `
      <div class="bg-white rounded-lg shadow p-3 hover:shadow-lg transition cursor-pointer border-l-4 ${priorityBorder}" 
           data-montaggio-id="${m.id}">
        <div class="flex justify-between items-start mb-2">
          <div class="flex-1">
            <div class="font-semibold text-base">${m.cliente || 'Cliente sconosciuto'}</div>
            ${m.numero_contratto ? `<div class="text-xs text-gray-500">N° ${m.numero_contratto}</div>` : ''}
            ${m.cliente_telefono ? `<div class="text-xs text-gray-500"><i class="fas fa-phone mr-1"></i>${m.cliente_telefono}</div>` : ''}
            ${m.cliente_indirizzo ? `<div class="text-xs text-gray-600">📍 ${m.cliente_indirizzo}</div>` : ''}
             ${m.cliente_citta || m.cliente_provincia ? `<div class="text-xs text-gray-600">${m.cliente_citta || ''}${m.cliente_provincia ? ` (${m.cliente_provincia})` : ''}</div>` : ''}
            ${m.data_montaggio || m.ora_montaggio ? `
              <div class="text-sm font-semibold text-blue-600 mt-2">
                <i class="far fa-calendar-alt mr-1"></i>
                ${m.data_montaggio ? new Date(m.data_montaggio).toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short' }) : ''}
                ${m.ora_montaggio ? `<i class="far fa-clock ml-2 mr-1"></i>${m.ora_montaggio}` : ''}
              </div>
            ` : ''}
          </div>
          <span class="px-2 py-1 rounded text-xs ${statoBadge}">${m.stato.replace(/_/g, ' ')}</span>
        </div>

        <div class="text-sm mb-2">
          <div class="font-medium text-gray-700">
            Prodotti:
            ${m.prodotti_dettagliati ? ` <span class="text-xs font-normal text-blue-600">(Tot. pezzi: ${m.prodotti_dettagliati.reduce((sum, p) => sum + (p.quantita || 1), 0)})</span>` : ''}
          </div>
          <div class="text-gray-600 text-xs">${prodotti}</div>
        </div>

     ${(m.prodotti_arrivati_lista || m.prodotti_mancanti_lista || m.prodotti_dettagliati) ? `
          <div class="mt-2 pt-2 border-t text-xs">
            ${m.prodotti_arrivati_lista && m.prodotti_arrivati_lista.length > 0 ? `
              <div class="mb-2">
                <div class="text-green-700 font-semibold mb-1">✓ Arrivati (${m.prodotti_arrivati_lista.length}):</div>
                ${m.prodotti_arrivati_lista.map(p => `
                  <div class="text-gray-700 ml-2">
                    • ${p.nome}${p.fornitore && p.fornitore !== '-' ? ` - ${p.fornitore}` : ''} 
                    <span class="font-semibold">| Qtà: ${p.quantita || 1}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
            ${m.prodotti_mancanti_lista && m.prodotti_mancanti_lista.length > 0 ? `
              <div class="mb-2">
                <div class="text-orange-700 font-semibold mb-1">⏳ In Attesa (${m.prodotti_mancanti_lista.length}):</div>
                ${m.prodotti_mancanti_lista.map(p => `
                  <div class="text-gray-700 ml-2">
                    • ${p.nome}${p.fornitore && p.fornitore !== '-' ? ` - ${p.fornitore}` : ''} 
                    <span class="font-semibold">| Qtà: ${p.quantita || 1}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
            ${m.prodotti_dettagliati && m.prodotti_dettagliati.length > 0 && !m.prodotti_arrivati_lista && !m.prodotti_mancanti_lista ? `
              <div>
                <div class="text-blue-700 font-semibold mb-1">📦 Tutti i prodotti (${m.prodotti_dettagliati.length}):</div>
                ${m.prodotti_dettagliati.map(p => `
                  <div class="text-gray-700 ml-2">
                    • ${p.nome}${p.fornitore && p.fornitore !== '-' ? ` - ${p.fornitore}` : ''} 
                    <span class="font-semibold">| Qtà: ${p.quantita || 1}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  };

  const getMontaggioStatoBadge = (stato) => {
    const colors = {
      'attesa_merci': 'bg-red-100 text-red-800',
      'da_programmare': 'bg-orange-100 text-orange-800',
      'programmato': 'bg-blue-100 text-blue-800',
      'completato': 'bg-green-100 text-green-800',
      'da_ritornare': 'bg-yellow-100 text-yellow-800',
      'manutenzione': 'bg-purple-100 text-purple-800',
      'annullato': 'bg-red-100 text-red-800'
    };

    return colors[stato] || 'bg-gray-100';
  };

  const getPriorityBorder = (priorita) => {
    const colors = {
      'critica': 'border-red-500',
      'alta': 'border-orange-500',
      'normale': 'border-gray-300',
      'bassa': 'border-green-500'
    };
    return colors[priorita] || 'border-gray-300';
  };

  const getPriorityColor = (priorita) => {
    const colors = {
      'critica': 'text-red-600',
      'alta': 'text-orange-600',
      'normale': 'text-gray-600',
      'bassa': 'text-green-600'
    };
    return colors[priorita] || 'text-gray-600';
  };

  const getPriorityLabel = (priorita) => {
    const labels = {
      'critica': '🔴 CRITICA',
      'alta': '🟠 ALTA',
      'normale': '🟢 Normale',
      'bassa': '🔵 Bassa'
    };
    return labels[priorita] || priorita;
  };

  const renderCalendarMontaggi = () => {
    $('#calendarView').style.display = 'block';
    $('#listView').style.display = 'none';
    $('#viewToggle').innerHTML = '<i class="fas fa-list"></i> Vista Lista';

     const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    $('#monthYear').textContent = `${monthNames[selectedMonth]} ${selectedYear}`;

    const firstDay = new Date(selectedYear, selectedMonth, 1).getDay();
    const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    const adjustedFirstDay = firstDay === 0 ? 6 : firstDay - 1;

    // Filtra solo montaggi programmati per il calendario
    const programmati = montaggiAll.filter(m => m.stato === 'programmato' || m.stato === 'da_programmare');

    let html = `
      <div class="grid grid-cols-7 gap-0 border">
        <div class="p-2 bg-gray-100 font-semibold text-center border">Lun</div>
        <div class="p-2 bg-gray-100 font-semibold text-center border">Mar</div>
        <div class="p-2 bg-gray-100 font-semibold text-center border">Mer</div>
        <div class="p-2 bg-gray-100 font-semibold text-center border">Gio</div>
        <div class="p-2 bg-gray-100 font-semibold text-center border">Ven</div>
        <div class="p-2 bg-gray-100 font-semibold text-center border">Sab</div>
        <div class="p-2 bg-gray-100 font-semibold text-center border">Dom</div>
    `;

    for (let i = 0; i < adjustedFirstDay; i++) {
      html += '<div class="border min-h-[100px] p-2 bg-gray-50"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dayMontaggi = programmati.filter(m => {
        if (!m.data_montaggio) return false;
        const d = new Date(m.data_montaggio);
        return d.getDate() === day && d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
      }).sort((a, b) => (a.ora_montaggio || '').localeCompare(b.ora_montaggio || ''));
      
      //  Appuntamenti per questo giorno
      const dayRilievi = appointments.filter(a => {
        const d = new Date(a.data_ora);
        return d.getDate() === day && d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
      });
      
      const totalItems = dayMontaggi.length + dayRilievi.length;

      const isToday = day === today.getDate() && selectedMonth === currentMonth && selectedYear === currentYear;

       html += `
        <div class="border min-h-[120px] p-2 ${isToday ? 'bg-orange-50' : ''} hover:bg-gray-50">
          <div class="flex items-center justify-between mb-1">
            <div class="font-semibold">${day}</div>
            ${totalItems ? `<span class="text-xs text-gray-500">${totalItems}</span>` : ''}
          </div>
          <div class="space-y-1 text-xs max-h-40 overflow-y-auto">
            ${dayMontaggi.map(m => `
               <div class="p-1 rounded cursor-pointer ${
                m.stato === 'programmato' ? 'bg-blue-100 border-l-2 border-blue-500' :
                m.stato === 'completato' ? 'bg-green-100 border-l-2 border-green-500' :
                m.stato === 'da_ritornare' ? 'bg-yellow-100 border-l-2 border-yellow-500' :
                m.stato === 'manutenzione' ? 'bg-purple-100 border-l-2 border-purple-500' :
                'bg-orange-100 border-l-2 border-orange-500'
              }"
                   onclick="window.openMontaggioModalById(${m.id})">
                <div class="font-semibold truncate">${m.ora_montaggio ? m.ora_montaggio.substring(0,5) : ''} ${m.cliente || ''}</div>
                <div class="text-xs text-gray-600 truncate">${m.prodotti_da_montare ? m.prodotti_da_montare.split(',')[0].replace(/_/g, ' ') : ''}</div>
                ${m.montatori ? `<div class="text-xs text-gray-600 truncate">${m.montatori}</div>` : ''}
              </div>
            `).join('')}
            ${dayRilievi.map(a => {
              const apptJson = JSON.stringify(a).replace(/"/g, '&quot;');
              const hhmm = new Date(a.data_ora).toTimeString().substring(0,5);
              return `
              <div class="p-1 rounded cursor-pointer bg-purple-100 border-l-2 border-purple-500"
                   onclick="window.openAppointmentModal(${apptJson})">
                <div class="font-semibold truncate">${hhmm} ${a.cliente || a.titolo || ''}</div>
                <div class="text-xs text-gray-600 truncate">${a.descrizione || ''}</div>
              </div>
            `}).join('')}
          </div>
        </div>
      `;
    }

    html += '</div>';
    $('#calendar').innerHTML = html;
  };

  // Esponi funzione globale per onclick nel calendario
  window.openMontaggioModalById = async (id) => {
    const montaggio = montaggiAll.find(m => m.id == id);
    if (montaggio) openMontaggioModal(montaggio);
  };
  
  //  Funzione globale per aprire appuntamento dal calendario
  window.openAppointmentModalById = async (id) => {
    const appointment = rilievi_programmati.find(a => a.id == id);
    if (appointment) {
      // Naviga alla sezione Agenda/Rilievi
      state.currentPage = 'appointments';
      await renderAppointments();
      // Qui potresti aprire il modal dell'appuntamento se esiste una funzione
      notify('Appuntamento: ' + (appointment.titolo || 'Rilievo'), 'info');
    }
  };

  $('#viewToggle').addEventListener('click', () => {
    viewMode = viewMode === 'list' ? 'calendar' : 'list';
    updateView();
  });

  $('#prevMonth')?.addEventListener('click', async () => {
    selectedMonth--;
    if (selectedMonth < 0) { selectedMonth = 11; selectedYear--; }
    // Ricarica appuntamenti per il nuovo anno
    const yearStart = `${selectedYear}-01-01`;
    const yearEnd = `${selectedYear}-12-31`;
    try {
      const res = await api('get', `/api/appointments?from=${yearStart}&to=${yearEnd}`);
      appointments = res.appointments || [];
    } catch (e) {
      appointmentsAll = [];
    }
    renderCalendarMontaggi();
  });

  $('#nextMonth')?.addEventListener('click', async () => {
    selectedMonth++;
    if (selectedMonth > 11) { selectedMonth = 0; selectedYear++; }
    // Ricarica appuntamenti per il nuovo anno
    const yearStart = `${selectedYear}-01-01`;
    const yearEnd = `${selectedYear}-12-31`;
    try {
      const res = await api('get', `/api/appointments?from=${yearStart}&to=${yearEnd}`);
      appointments = res.appointments || [];
    } catch (e) {
      appointmentsAll = [];
    }
    renderCalendarMontaggi();
  });

  // Event listeners per i filtri
  $('#apply_filters_montaggio').addEventListener('click', applyFilters);
  $('#reset_filters_montaggio').addEventListener('click', resetFilters);

  await loadMontaggi();
}

/* ---------- Modale Montaggio (Semplificata come Rilievi) ---------- */
function openMontaggioModal(montaggio) {
  const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
  const card = el('div', { class: 'bg-white p-6 rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-xl' });
  
  // Mostra tutti i prodotti
  const prodotti = montaggio.prodotti_da_montare 
    ? montaggio.prodotti_da_montare.split(',').map(p => p.replace(/_/g, ' ').trim()).join(', ')
    : 'N/A';
  
  card.innerHTML = `
     <div class="flex justify-between items-center mb-4">
      <div>
        <h3 class="text-lg font-semibold">
          <i class="fas fa-tools mr-2"></i>Montaggio - Ordine #${montaggio.order_id}
        </h3>
        ${montaggio.prodotti_dettagliati ? `
          <div class="text-sm text-gray-600 mt-1">
            Totale pezzi da montare: <span class="font-semibold text-blue-600">${montaggio.prodotti_dettagliati.reduce((sum, p) => sum + (p.quantita || 1), 0)}</span>
          </div>
        ` : ''}
      </div>
      <button id="closeModal" class="text-gray-500 hover:text-gray-700">
        <i class="fas fa-times text-xl"></i>
      </button>
    </div>

    <!-- Info Cliente -->
    <div class="grid md:grid-cols-2 gap-4 mb-4">
      <div class="p-3 bg-gray-50 rounded">
        <div class="text-sm text-gray-600">Cliente</div>
        <div class="font-semibold">${montaggio.cliente || 'N/A'}</div>
        ${montaggio.cliente_telefono ? `<div class="text-sm"><i class="fas fa-phone mr-1"></i>${montaggio.cliente_telefono}</div>` : ''}
        ${montaggio.cliente_indirizzo ? `<div class="text-sm mt-1"><i class="fas fa-map-marker-alt mr-1"></i>${montaggio.cliente_indirizzo}</div>` : ''}
      </div>
      <div class="p-3 bg-gray-50 rounded">
        <div class="text-sm text-gray-600">Ordine</div>
        <div class="font-medium">N° ${montaggio.numero_contratto || montaggio.customer_numero_contratto || montaggio.order_id}</div>
        ${montaggio.prodotti_arrivati && montaggio.prodotti_totali ? `
          <div class="text-sm text-gray-600 mt-1">
            Prodotti arrivati: ${montaggio.prodotti_arrivati}/${montaggio.prodotti_totali}
          </div>
        ` : ''}
      </div>
    </div>

    <!-- Prodotti da montare -->
    <div class="mb-4 p-4 bg-blue-50 rounded border-l-4 border-blue-500">
      <h4 class="font-semibold mb-2"><i class="fas fa-box mr-2"></i>Prodotti da montare</h4>
      ${montaggio.prodotti_arrivati_lista && montaggio.prodotti_arrivati_lista.length > 0 ? `
        <div class="mb-3">
          <div class="text-xs font-semibold text-green-600 mb-2">✅ Arrivati</div>
          <div class="space-y-1">
            ${montaggio.prodotti_arrivati_lista.map(p => `
              <div class="flex items-center justify-between text-sm bg-green-50 p-2 rounded border-l-2 border-green-500">
                <div>
                  <span class="font-medium">${p.nome}</span>
                  ${p.fornitore && p.fornitore !== '-' ? `
                    <span class="text-blue-600 ml-2 text-xs">• ${p.fornitore}</span>
                  ` : ''}
                </div>
                <span class="px-2 py-1 bg-green-200 rounded text-xs font-semibold">
                  Qtà: ${p.quantita}
                </span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      ${montaggio.prodotti_mancanti_lista && montaggio.prodotti_mancanti_lista.length > 0 ? `
        <div>
          <div class="text-xs font-semibold text-orange-600 mb-2">⏳ In Attesa</div>
          <div class="space-y-1">
            ${montaggio.prodotti_mancanti_lista.map(p => `
              <div class="flex items-center justify-between text-sm bg-orange-50 p-2 rounded border-l-2 border-orange-500">
                <div>
                  <span class="font-medium">${p.nome}</span>
                  ${p.fornitore && p.fornitore !== '-' ? `
                    <span class="text-blue-600 ml-2 text-xs">• ${p.fornitore}</span>
                  ` : ''}
                </div>
                <span class="px-2 py-1 bg-orange-200 rounded text-xs font-semibold">
                  Qtà: ${p.quantita}
                </span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
      ${(!montaggio.prodotti_arrivati_lista || montaggio.prodotti_arrivati_lista.length === 0) && 
        (!montaggio.prodotti_mancanti_lista || montaggio.prodotti_mancanti_lista.length === 0) ? `
        <div class="text-sm">${prodotti}</div>
      ` : ''}
    </div>

    <!-- Programmazione Montaggio -->
    <div class="mb-4 p-4 bg-orange-50 rounded border-l-4 border-orange-500">
      <h4 class="font-semibold mb-3"><i class="fas fa-calendar-alt mr-2"></i>Programmazione</h4>
      <div class="grid md:grid-cols-4 gap-3">
        <div>
          <label class="text-xs text-gray-600">Data montaggio</label>
          <input type="date" id="dataMontaggio" class="p-2 border rounded w-full" value="${montaggio.data_montaggio || ''}" />
        </div>
        <div>
          <label class="text-xs text-gray-600">Ora</label>
          <input type="time" id="oraMontaggio" class="p-2 border rounded w-full" value="${montaggio.ora_montaggio || ''}" />
        </div>
        <div>
          <label class="text-xs text-gray-600">Priorità</label>
          <select id="priorita" class="p-2 border rounded w-full">
            ${['bassa','normale','alta','critica'].map(p => `<option ${montaggio.priorita===p?'selected':''}>${p}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="text-xs text-gray-600">Stato</label>
          <select id="stato" class="p-2 border rounded w-full">
            ${['da_programmare','programmato','completato','da_ritornare','manutenzione','annullato'].map(s => `<option ${montaggio.stato===s?'selected':''}>${s}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="mt-3">
        <label class="text-xs text-gray-600">Montatori</label>
        <input type="text" id="montatori" class="p-2 border rounded w-full" placeholder="es. Mario Rossi, Luigi Bianchi" value="${montaggio.montatori || ''}" />
      </div>
    </div>

    <!-- Tempo Stimato (dal Rilievo) -->
    ${montaggio.tempo_stimato_montaggio ? `
    <div class="mb-4 p-3 bg-blue-50 rounded border-l-4 border-blue-500">
      <label class="block text-sm font-semibold mb-1">
        <i class="fas fa-clock mr-1"></i>Tempo stimato dal rilevatore
      </label>
      <p class="text-gray-700">${montaggio.tempo_stimato_montaggio}</p>
    </div>
    ` : ''}

    <!-- Note -->
    <div class="mb-4">
      <label class="block text-sm font-medium mb-1">Note montaggio</label>
      <textarea id="noteMontaggio" rows="3" class="p-2 border rounded w-full">${montaggio.note || ''}</textarea>
    </div>

    <div class="flex justify-end gap-2">
      ${montaggio.stato === 'completato' ? `
        <button id="btnCreaPraticaEnea" class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">
          <i class="fas fa-file-invoice mr-1"></i>Crea Pratica ENEA
        </button>
      ` : ''}
      <button id="cancelBtn" class="px-4 py-2 border rounded">Annulla</button>
      <button id="saveBtn" class="px-4 py-2 bg-blue-500 text-white rounded">Salva Modifiche</button>
    </div>
    
  `;

  wrap.appendChild(card);
  document.body.appendChild(wrap);

  $('#closeModal', card).addEventListener('click', () => wrap.remove());
  $('#cancelBtn', card).addEventListener('click', () => wrap.remove());

  $('#saveBtn', card).addEventListener('click', async () => {
    const body = {
      data_montaggio: $('#dataMontaggio', card).value || null,
      ora_montaggio: $('#oraMontaggio', card).value || null,
      montatori: $('#montatori', card).value || null,
      priorita: $('#priorita', card).value || 'normale',
      stato: $('#stato', card).value || 'da_programmare',
      note: $('#noteMontaggio', card).value || null
    };

    try {
      await api('put', `/api/montaggi/cliente/${montaggio.customer_id}/ordine/${montaggio.order_id}`, body);
      notify('Montaggio aggiornato con successo', 'success');
      wrap.remove();
      renderMontaggi(); // Ricarica la vista
    } catch (e) {
      notify('Errore nell\'aggiornamento', 'error');
    }
  });

 // Crea Pratica ENEA
  const btnEnea = $('#btnCreaPraticaEnea', card);
  if (btnEnea) {
    btnEnea.addEventListener('click', async () => {
      if (!confirm('Creare pratica ENEA?')) return;
      try {
        await api('post', `/api/pratiche-enea/crea-da-montaggio/${montaggio.id}`);
        notify('Pratica creata', 'success');
        wrap.remove();
        renderMontaggi();
      } catch (e) {
        notify('Errore', 'error');
      }
    });
  }
}

/* ---------- Helper functions per Preventivi (GLOBALI) ---------- */
const getStatoBadge = (stato) => {
  const colors = {
    'in_attesa': 'bg-yellow-100 text-yellow-800',
    'in_esecuzione': 'bg-blue-100 text-blue-800',
    'preventivo_inviato': 'bg-green-100 text-green-800',
    'modifiche_da_eseguire': 'bg-orange-100 text-orange-800',
    'preventivo_accettato': 'bg-green-200 text-green-900',
    'non_interessato': 'bg-red-100 text-red-800'
  };
  return colors[stato] || 'bg-gray-100';
};

const getPrioritaBadge = (priorita) => {
  const colors = {
    'in_giornata': 'bg-red-500 text-white',
    'entro_48h': 'bg-orange-500 text-white',
    'entro_72h': 'bg-yellow-500 text-gray-900',
    'entro_96h': 'bg-green-500 text-white'
  };
  return colors[priorita] || 'bg-gray-100';
};

const getPrioritaLabel = (priorita) => {
  const labels = {
    'in_giornata': '🔴 Urgente - In giornata',
    'entro_48h': '🟠 Alta - Entro 48h',
    'entro_72h': '🟡 Media - Entro 72h',
    'entro_96h': '🟢 Bassa - Entro 96h'
  };
  return labels[priorita] || priorita;
};

const getStatoLabel = (stato) => {
  const labels = {
    'in_attesa': 'In attesa',
    'in_esecuzione': 'In esecuzione',
    'preventivo_inviato': 'Preventivo inviato',
    'modifiche_da_eseguire': 'Modifiche da eseguire',
    'preventivo_accettato': 'Preventivo accettato',
    'non_interessato': 'Non interessato'
  };
  return labels[stato] || stato;
};


/* ---------- Preventivi ---------- */
async function renderPreventivi() {
  const main = $('#main');
  
  //  CORREZIONE: Verifica scope lato client (senza await)
  const hasPreventivi = Array.isArray(state.user?.scopes) && state.user.scopes.includes('preventivi');
  const isAdmin = state.user?.role === 'admin';
  
  main.innerHTML = `
    <div class="flex justify-between items-center mb-4">
      <h2 class="text-xl font-semibold">
        <i class="fas fa-file-invoice mr-2"></i>Preventivi
      </h2>
      ${!hasPreventivi ? `
        <button id="prev_new" class="px-3 py-2 bg-blue-500 text-white rounded">
          <i class="fas fa-plus mr-1"></i>Nuova Richiesta
        </button>
      ` : ''}
    </div>

    <!-- Filtri -->
    <div class="bg-white rounded-lg shadow p-4 mb-4">
      <div class="grid md:grid-cols-4 gap-3">
        <select id="filter_stato" class="p-2 border rounded">
          <option value="">Tutti gli stati</option>
          <option value="in_attesa">In attesa</option>
          <option value="in_esecuzione">In esecuzione</option>
          <option value="preventivo_inviato">Preventivo inviato</option>
          <option value="modifiche_da_eseguire">Modifiche da eseguire</option>
          ${!hasPreventivi ? `
            <option value="preventivo_accettato">Preventivo accettato</option>
            <option value="non_interessato">Non interessato</option>
          ` : ''}
        </select>
        <input id="filter_cliente" class="p-2 border rounded" placeholder="Filtra per cliente..." />
        ${isAdmin || hasPreventivi ? `
          <select id="filter_richiedente" class="p-2 border rounded">
            <option value="">Tutti i richiedenti</option>
          </select>
        ` : ''}
        <button id="clear_filters_prev" class="px-3 py-2 bg-gray-500 text-white rounded">Reset Filtri</button>
      </div>
      ${!hasPreventivi ? `
        <div class="mt-3 p-3 bg-blue-50 rounded text-sm text-blue-700">
          <i class="fas fa-info-circle mr-2"></i>
          Stai visualizzando <strong>tutte</strong> le tue richieste (incluse quelle completate/archiviate)
        </div>
      ` : ''}
    </div>

     ${isAdmin ? `
      <div id="prev_stats" class="bg-white rounded-lg shadow p-4 mb-4">
        <div class="flex justify-between items-center mb-3">
          <h3 class="font-semibold text-gray-700">
            <i class="fas fa-chart-bar mr-2"></i>Statistiche Assegnazioni
          </h3>
          <button id="toggleStats" class="text-sm text-blue-600 hover:text-blue-800">
            <i class="fas fa-chevron-down"></i> Mostra/Nascondi
          </button>
        </div>
        <div id="statsContent" class="hidden">
          <div class="text-center text-gray-500 py-4">
            <i class="fas fa-spinner fa-spin"></i> Caricamento statistiche...
          </div>
        </div>
      </div>
    ` : ''}

    <div id="prev_list" class="grid md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
	<div id="prev_pagination" class="flex justify-center items-center gap-3 mt-4"></div>
  `;

  //  CORREZIONE: Carica preventivi (il filtro backend gestisce già la visibilità)
  const currentPage = Number(state.params?.page || 1);
const limit = 20;

const filtroStato = state.params?.stato || '';
const filtroCliente = state.params?.cliente || '';
const filtroRichiedente = state.params?.richiedente || '';

const qs = new URLSearchParams({
  page: currentPage,
  limit,
  stato: filtroStato,
  cliente: filtroCliente,
  richiedente: filtroRichiedente
});

const { preventivi, hasMore } = await api('get', `/api/preventivi?${qs.toString()}`);
  
 // Popola filtro richiedenti dal backend, non dalla pagina corrente
if (isAdmin || hasPreventivi) {
  try {
    const { richiedenti } = await api('get', '/api/preventivi/richiedenti');
    const richSel = $('#filter_richiedente');

    if (richSel) {
      richSel.innerHTML = `<option value="">Tutti i richiedenti</option>` +
        (richiedenti || [])
          .map(r => r.nome)
          .filter(Boolean)
          .map(nome => `<option value="${nome}">${nome}</option>`)
          .join('');

      richSel.value = filtroRichiedente;
    }
  } catch (error) {
    console.error('Errore caricamento richiedenti:', error);
  }
}
$('#filter_stato').value = filtroStato;
$('#filter_cliente').value = filtroCliente;
if ($('#filter_richiedente')) $('#filter_richiedente').value = filtroRichiedente;    
	 if (isAdmin) {
    try {
      const { stats } = await api('get', '/api/preventivi/stats/assignments');
      
      const statsContent = $('#statsContent');
      if (statsContent && stats.length > 0) {
        statsContent.innerHTML = `
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-2 text-left">Preventivista</th>
                  <th class="px-3 py-2 text-center">Attivi</th>
                  <th class="px-3 py-2 text-center">In Attesa</th>
                  <th class="px-3 py-2 text-center">In Esecuzione</th>
                  <th class="px-3 py-2 text-center">Inviati</th>
                  <th class="px-3 py-2 text-center">Accettati</th>
                  <th class="px-3 py-2 text-center">Totali</th>
                </tr>
              </thead>
              <tbody class="divide-y">
                ${stats.map(s => `
                  <tr class="hover:bg-gray-50">
                    <td class="px-3 py-2 font-medium">
                      <i class="fas fa-user mr-1 text-gray-400"></i>
                      ${s.nome_completo || s.username}
                    </td>
                    <td class="px-3 py-2 text-center">
                      <span class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-semibold">
                        ${s.attivi}
                      </span>
                    </td>
                    <td class="px-3 py-2 text-center text-gray-600">${s.in_attesa}</td>
                    <td class="px-3 py-2 text-center text-gray-600">${s.in_esecuzione}</td>
                    <td class="px-3 py-2 text-center text-gray-600">${s.inviati}</td>
                    <td class="px-3 py-2 text-center">
                      <span class="text-green-600 font-medium">${s.accettati}</span>
                    </td>
                    <td class="px-3 py-2 text-center">
                      <span class="font-semibold">${s.totali}</span>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          
          <div class="mt-3 p-3 bg-blue-50 rounded text-sm">
            <div class="flex items-center gap-4 flex-wrap">
              <div>
                <span class="font-semibold">📊 Totale preventivi attivi:</span>
                <span class="ml-1 text-blue-700 font-bold">${stats.reduce((sum, s) => sum + s.attivi, 0)}</span>
              </div>
              <div>
                <span class="font-semibold">✅ Totale accettati:</span>
                <span class="ml-1 text-green-700 font-bold">${stats.reduce((sum, s) => sum + s.accettati, 0)}</span>
              </div>
              <div>
                <span class="font-semibold">📝 Totale preventivi:</span>
                <span class="ml-1 font-bold">${stats.reduce((sum, s) => sum + s.totali, 0)}</span>
              </div>
            </div>
          </div>
        `;
      } else if (statsContent) {
        statsContent.innerHTML = `
          <div class="text-center text-gray-500 py-4">
            Nessuna statistica disponibile
          </div>
        `;
      }
    } catch (error) {
      console.error('Errore caricamento statistiche:', error);
    }
    
    // Toggle statistiche
    const toggleStats = $('#toggleStats');
    const statsContent = $('#statsContent');
    if (toggleStats && statsContent) {
      toggleStats.addEventListener('click', () => {
        statsContent.classList.toggle('hidden');
        const icon = toggleStats.querySelector('i');
        if (icon) {
          icon.classList.toggle('fa-chevron-down');
          icon.classList.toggle('fa-chevron-up');
        }
      });
    }
  }
  const draw = (rows) => {
    const list = $('#prev_list');
    if (!rows.length) {
      list.innerHTML = `<div class="bg-white rounded-lg shadow p-6 col-span-3 text-gray-600">Nessun preventivo</div>`;
      return;
    }

    list.innerHTML = rows.map(p => `
      <div class="bg-white rounded-lg shadow p-4 hover:shadow-lg transition cursor-pointer relative" data-prev-id="${p.id}">
        ${(p.stato === 'preventivo_accettato' || p.stato === 'non_interessato') ? `
          <div class="absolute top-2 right-2 px-2 py-1 bg-gray-500 text-white text-xs rounded">
            <i class="fas fa-archive mr-1"></i>Archiviato
          </div>
        ` : ''}
        
        <div class="flex justify-between items-start mb-3">
          <div class="flex-1">
            <div class="font-semibold text-lg">${p.cliente || 'Cliente sconosciuto'}</div>
            <div class="text-sm text-gray-500">Richiesto da: ${p.richiedente_nome || '-'}</div>
            <div class="text-xs text-gray-400">${fmtDT(p.created_at)}</div>
			 ${p.assegnato_a ? `
              <div class="text-xs text-green-600 mt-1">
                <i class="fas fa-user-check mr-1"></i>Assegnato a: ${p.assegnato_nome || 'Preventivista'}
              </div>
            ` : `
              <div class="text-xs text-orange-600 mt-1">
                <i class="fas fa-exclamation-circle mr-1"></i>Non ancora assegnato
              </div>
            `}
          </div>
          <div class="flex flex-col gap-2 items-end">
            <span class="px-2 py-1 rounded text-xs ${getStatoBadge(p.stato)}">
              ${getStatoLabel(p.stato)}
            </span>
            <span class="px-2 py-1 rounded text-xs ${getPrioritaBadge(p.priorita)}">
              ${getPrioritaLabel(p.priorita)}
            </span>
          </div>
        </div>

        ${p.note_richiesta ? `
          <div class="text-sm text-gray-700 mb-2 border-l-2 border-blue-300 pl-2">
            ${p.note_richiesta}
          </div>
        ` : ''}
		
		${p.note_preventivista ? `
  <div class="text-xs text-gray-500 mt-2 flex items-center gap-1">
    <i class="fas fa-clipboard-check"></i>
    Note preventivista presenti
  </div>
` : ''}

        <div class="flex gap-3 text-sm text-gray-600 mt-3">
          <div>
            <i class="fas fa-paperclip mr-1"></i>
            Richiesta: ${p.allegati_richiesta || 0}
          </div>
          <div>
            <i class="fas fa-file-pdf mr-1"></i>
            Preventivo: ${p.allegati_preventivo || 0}
          </div>
        </div>

        ${p.cliente_telefono ? `
          <div class="text-sm text-gray-500 mt-2">
            <i class="fas fa-phone mr-1"></i>${p.cliente_telefono}
          </div>
        ` : ''}
      </div>
    `).join('');

    // Click su card per aprire modale

    $$('[data-prev-id]').forEach(card => {
      card.addEventListener('click', async () => {
        const prevId = card.dataset.prevId;
        const { preventivo } = await api('get', `/api/preventivi/${prevId}`);
        openPreventivoModal(preventivo);
      });
    });
  };

  draw(preventivi);
const pagination = $('#prev_pagination');
if (pagination) {
  pagination.innerHTML = `
    <button id="prevPageBtn" class="px-3 py-2 border rounded ${currentPage <= 1 ? 'opacity-50 cursor-not-allowed' : ''}" ${currentPage <= 1 ? 'disabled' : ''}>
      <i class="fas fa-chevron-left mr-1"></i> Indietro
    </button>

    <span class="text-sm text-gray-600">
      Pagina ${currentPage}
    </span>

    <button id="nextPageBtn" class="px-3 py-2 border rounded ${!hasMore ? 'opacity-50 cursor-not-allowed' : ''}" ${!hasMore ? 'disabled' : ''}>
      Avanti <i class="fas fa-chevron-right ml-1"></i>
    </button>
  `;

  $('#prevPageBtn')?.addEventListener('click', () => {
  if (currentPage > 1) {
    goto('preventivi', {
      page: currentPage - 1,
      stato: filtroStato,
      cliente: filtroCliente,
      richiedente: filtroRichiedente
    });
  }
});

$('#nextPageBtn')?.addEventListener('click', () => {
  if (hasMore) {
    goto('preventivi', {
      page: currentPage + 1,
      stato: filtroStato,
      cliente: filtroCliente,
      richiedente: filtroRichiedente
    });
  }
});
}
  // Filtri server-side: non filtrare più solo la pagina corrente
const applyFilters = () => {
  goto('preventivi', {
    page: 1,
    stato: $('#filter_stato').value,
    cliente: $('#filter_cliente').value.trim(),
    richiedente: $('#filter_richiedente') ? $('#filter_richiedente').value : ''
  });
};

let preventiviFilterTimer = null;

$('#filter_stato').addEventListener('change', applyFilters);

$('#filter_cliente').addEventListener('input', () => {
  clearTimeout(preventiviFilterTimer);
  preventiviFilterTimer = setTimeout(applyFilters, 500);
});

$('#filter_richiedente')?.addEventListener('change', applyFilters);

$('#clear_filters_prev').addEventListener('click', () => {
  goto('preventivi', { page: 1 });
});

  // Nuova richiesta (solo per venditori senza scope preventivi)
  $('#prev_new')?.addEventListener('click', () => openNuovaRichiestaModal());
}


/* Modale nuova richiesta preventivo */
async function openNuovaRichiestaModal(preselectedCustomerId = null) {
  let customers = [];
  let preselectedCustomer = null;
  
  if (preselectedCustomerId) {
    // Se c'è un cliente preselezionato, carica solo quello
    try {
      const customerData = await api('get', `/api/customers/${preselectedCustomerId}`);
      preselectedCustomer = customerData.customer || customerData;
      customers = [preselectedCustomer];
    } catch (error) {
      console.error('Errore caricamento cliente:', error);
      notify('Errore caricamento dati cliente', 'error');
      return;
    }
  } else {
    // Altrimenti carica tutti i clienti (con limite alto)
    const result = await api('get', '/api/customers?page=1&limit=10000');
    customers = result.customers || [];
  }
  
  const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
  const card = el('div', { class: 'bg-white p-6 rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl' });
  
  card.innerHTML = `
    <h3 class="text-lg font-semibold mb-4">Nuova Richiesta Preventivo</h3>
    <form id="richiestaForm" class="space-y-4">
      <div>
       <label class="block text-sm font-medium mb-1">Cliente *</label>
        ${preselectedCustomerId ? `
          <div class="p-3 border rounded bg-gray-50 font-medium">
            ${preselectedCustomer ? `${preselectedCustomer.nome} ${preselectedCustomer.cognome}` : 'Cliente selezionato'}
          </div>
          <input type="hidden" name="customer_id" value="${preselectedCustomerId}" />
        ` : `
          <select name="customer_id" id="customerSelectRichiesta" class="p-2 border rounded w-full" required>
            <option value="">-- Seleziona cliente --</option>
            ${customers.map(c => `<option value="${c.id}">${c.nome} ${c.cognome}</option>`).join('')}
          </select>
        `}
      </div>
	  
      <div>
        <label class="block text-sm font-medium mb-1">Urgenza richiesta *</label>
        <select name="priorita" class="p-2 border rounded w-full" required>
          <option value="">-- Seleziona urgenza --</option>
          <option value="in_giornata">🔴 Urgente - In giornata</option>
          <option value="entro_48h">🟠 Alta priorità - Entro 48 ore</option>
          <option value="entro_72h">🟡 Media priorità - Entro 72 ore</option>
          <option value="entro_96h">🟢 Bassa priorità - Entro 96 ore</option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1">Note richiesta (opzionale)</label>
        <textarea name="note_richiesta" rows="3" class="p-2 border rounded w-full" placeholder="Descrivi la richiesta del cliente..."></textarea>
      </div>
<div class="grid md:grid-cols-2 gap-3">
  <div>
    <label class="block text-sm font-medium mb-1">Città</label>
    <input type="text" name="citta" class="p-2 border rounded w-full" placeholder="Es: Milano" />
  </div>
  <div>
    <label class="block text-sm font-medium mb-1">Provincia</label>
    <input type="text" name="provincia" class="p-2 border rounded w-full" placeholder="Es: MI" maxlength="2" />
  </div>
</div>
      <div class="border rounded p-4 bg-blue-50">
        <label class="block text-sm font-medium mb-2">
          <i class="fas fa-paperclip mr-1"></i>Allegati richiesta (OBBLIGATORI) *
        </label>
        <input type="file" id="fileInputRichiesta" multiple 
       accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx,.zip,.rar"
       class="p-2 border rounded w-full mb-2" />
<div class="text-xs text-gray-500">
  Formati supportati: PDF, Immagini (JPG, PNG), Word (DOC, DOCX), Excel (XLS, XLSX), ZIP, RAR
  <br>Dimensione massima: 20MB per file
</div>
        <div id="filesPreview" class="mt-2"></div>
      </div>

      <div class="flex justify-end gap-2">
        <button type="button" id="close" class="px-3 py-2 border rounded">Annulla</button>
        <button type="submit" class="px-3 py-2 bg-blue-500 text-white rounded">Invia Richiesta</button>
      </div>
    </form>
  `;
  
  wrap.appendChild(card);
  document.body.appendChild(wrap);

  let selectedFiles = [];
  $('#fileInputRichiesta', card).addEventListener('change', (e) => {
    selectedFiles = Array.from(e.target.files);
    const preview = $('#filesPreview', card);
    preview.innerHTML = selectedFiles.map(f => `
      <div class="text-sm text-gray-700"><i class="fas fa-file mr-1"></i>${f.name} (${formatFileSize(f.size)})</div>
    `).join('');
  });

  $('#close', card).addEventListener('click', () => wrap.remove());
  
    $('#richiestaForm', card).addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    
    
    const body = {
      customer_id: Number(fd.get('customer_id')),
      priorita: fd.get('priorita'),
      note_richiesta: fd.get('note_richiesta') || null
    };

    // Crea preventivo
    const { preventivo_id } = await api('post', '/api/preventivi', body);

    // Carica allegati
    for (const file of selectedFiles) {
  if (file.size > 20 * 1024 * 1024) {
    notify(`File troppo grande (max 20MB): ${file.name}`, 'error');
    continue;
  }
  
  // Validazione tipo file
  const allowedExtensions = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.rar'];
  const fileName = file.name.toLowerCase();
  const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));
  
  if (!hasValidExtension) {
    notify(`Formato non supportato: ${file.name}`, 'error');
    continue;
  }
  
  await uploadFilePrev(file, preventivo_id, 'richiesta');
}

    notify('Richiesta preventivo inviata', 'success');
    wrap.remove();
    renderPreventivi();
  });
}

/* Modale dettaglio preventivo */
async function openPreventivoModal(preventivo) {
  const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
  const card = el('div', { class: 'bg-white p-6 rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-xl' });
  
  // Verifica permessi basati su scope
  const hasPreventivi = Array.isArray(state.user?.scopes) && state.user.scopes.includes('preventivi');
  const isRichiedente = preventivo.richiedente_id === state.user?.id;
  const isAdmin = state.user?.role === 'admin';
 const canEdit = isAdmin || hasPreventivi;
  
  console.log('🔍 Debug Preventivo Modal:', {
    canEdit,
    isAdmin,
    hasPreventivi,
    assegnato_a: preventivo.assegnato_a,
    assegnato_nome: preventivo.assegnato_nome,
    stato: preventivo.stato,
    mostra_pulsante: canEdit && !preventivo.assegnato_a
  });

  card.innerHTML = `
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-lg font-semibold">Preventivo #${preventivo.id}</h3>
      <button id="closeModal" class="text-gray-500 hover:text-gray-700">
        <i class="fas fa-times"></i>
      </button>
    </div>

    <div class="grid md:grid-cols-2 gap-4 mb-4">
  <div class="p-3 bg-gray-50 rounded">
    <div class="text-sm text-gray-600">Cliente</div>
    <div class="font-semibold">${preventivo.cliente}</div>
    ${preventivo.cliente_telefono ? `<div class="text-sm mt-1"><i class="fas fa-phone mr-1"></i>${preventivo.cliente_telefono}</div>` : ''}
    ${preventivo.cliente_email ? `<div class="text-sm"><i class="fas fa-envelope mr-1"></i>${preventivo.cliente_email}</div>` : ''}
    ${preventivo.cliente_indirizzo ? `<div class="text-sm mt-2"><i class="fas fa-map-marker-alt mr-1"></i>${preventivo.cliente_indirizzo}</div>` : ''}
    ${preventivo.cliente_citta ? `<div class="text-sm text-gray-600">${preventivo.cliente_citta}${preventivo.cliente_provincia ? ` (${preventivo.cliente_provincia})` : ''}</div>` : ''}
  </div>

</div>

${preventivo.cliente_note ? `
  <div class="mb-4 p-3 bg-yellow-50 rounded border-l-4 border-yellow-500">
    <div class="text-sm font-medium mb-1"><i class="fas fa-sticky-note mr-1"></i>Note cliente:</div>
    <div class="text-sm text-gray-700">${preventivo.cliente_note}</div>
  </div>
` : ''}

<div class="mb-4 p-3 ${
      preventivo.priorita === 'in_giornata' ? 'bg-red-50 border-l-4 border-red-500' :
      preventivo.priorita === 'entro_48h' ? 'bg-orange-50 border-l-4 border-orange-500' :
      preventivo.priorita === 'entro_72h' ? 'bg-yellow-50 border-l-4 border-yellow-500' :
      'bg-green-50 border-l-4 border-green-500'
    } rounded">
      <div class="text-sm font-medium">Urgenza:</div>
      <div class="text-lg font-semibold">${getPrioritaLabel(preventivo.priorita || 'entro_96h')}</div>
    </div>


    ${preventivo.note_richiesta ? `
      <div class="mb-4 p-3 bg-blue-50 rounded border-l-4 border-blue-500">
        <div class="text-sm font-medium mb-1">Note richiesta:</div>
        <div class="text-sm">${preventivo.note_richiesta}</div>
      </div>
    ` : ''}

    <!-- Allegati richiesta -->
    <div class="mb-4">
      <div class="font-semibold mb-2">
        <i class="fas fa-paperclip mr-1"></i>Allegati richiesta
      </div>
      <div id="allegatiRichiesta" class="border rounded p-3 bg-gray-50"></div>
    </div>
    
	<!-- Note preventivista (solo chi ha scope preventivi può scrivere) -->
${canEdit ? `
  <div class="mb-4">
    <label class="block text-sm font-medium mb-1">
      <i class="fas fa-sticky-note mr-1"></i>Note preventivista (visibili solo internamente)
    </label>
    <textarea id="notePreventivista" rows="4" class="p-2 border rounded w-full" placeholder="Inserisci note tecniche, dettagli lavorazione, osservazioni...">${preventivo.note_preventivista || ''}</textarea>
    <div class="text-xs text-gray-500 mt-1">
      Queste note sono visibili solo al team che gestisce i preventivi
    </div>
  </div>
` : (preventivo.note_preventivista ? `
  <div class="mb-4 p-3 bg-gray-50 rounded border-l-4 border-gray-500">
    <div class="text-sm font-medium mb-1">
      <i class="fas fa-sticky-note mr-1"></i>Note preventivista:
    </div>
    <div class="text-sm text-gray-700 whitespace-pre-wrap">${preventivo.note_preventivista}</div>
  </div>
` : '')}

    <!-- Stato preventivo (solo chi ha scope preventivi può modificare) -->
    ${canEdit ? `
      <div class="mb-4">
        <label class="block text-sm font-medium mb-1">Stato preventivo</label>
        <select id="statoSelect" class="p-2 border rounded w-full">
          <option value="in_attesa" ${preventivo.stato === 'in_attesa' ? 'selected' : ''}>In attesa</option>
          <option value="in_esecuzione" ${preventivo.stato === 'in_esecuzione' ? 'selected' : ''}>In esecuzione</option>
          <option value="preventivo_inviato" ${preventivo.stato === 'preventivo_inviato' ? 'selected' : ''}>Preventivo inviato</option>
          <option value="modifiche_da_eseguire" ${preventivo.stato === 'modifiche_da_eseguire' ? 'selected' : ''}>Modifiche da eseguire</option>
          <option value="preventivo_accettato" ${preventivo.stato === 'preventivo_accettato' ? 'selected' : ''}>Preventivo accettato</option>
          <option value="non_interessato" ${preventivo.stato === 'non_interessato' ? 'selected' : ''}>Non interessato</option>
        </select>
      </div>
    ` : `
      <div class="mb-4 p-3 bg-gray-50 rounded">
        <div class="text-sm text-gray-600">Stato attuale</div>
        <div class="font-semibold">${preventivo.stato.replace(/_/g, ' ')}</div>
      </div>
    `}

    <!-- Allegati preventivo (chi ha scope preventivi può caricare) -->
    <div class="mb-4">
      <div class="font-semibold mb-2">
        <i class="fas fa-file-pdf mr-1"></i>Preventivo completato
      </div>
      <div id="allegatiPreventivo" class="border rounded p-3 bg-gray-50 mb-2"></div>
      ${canEdit ? `
  <input type="file" id="fileInputPreventivo" multiple class="p-2 border rounded w-full" />
  <div class="text-xs text-gray-500 mt-1">
    Formati supportati: PDF, Word (DOC, DOCX), Excel (XLS, XLSX), Immagini, ZIP
    <br>Dimensione massima: 20MB per file
  </div>
` : ''}
    </div>
 
    ${canEdit && !preventivo.assegnato_a ? `
      <div class="mb-4 p-4 bg-yellow-50 border border-yellow-300 rounded">
        <div class="flex items-center justify-between">
          <div>
            <div class="font-semibold text-yellow-800">
              <i class="fas fa-hand-paper mr-2"></i>Preventivo non assegnato
            </div>
            <div class="text-sm text-yellow-700 mt-1">
              Prendi in carico questa richiesta per lavorarci
            </div>
          </div>
          <button id="prendiInCaricoBtn" class="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded">
            <i class="fas fa-hand-paper mr-1"></i>Prendi in Carico
          </button>
        </div>
      </div>
    ` : ''}
    
    ${preventivo.assegnato_a ? `
      <div class="mb-4 p-3 bg-green-50 border border-green-300 rounded">
        <div class="text-sm text-green-700">
          <i class="fas fa-user-check mr-2"></i>
          Assegnato a: <strong>${preventivo.assegnato_nome || 'Utente #' + preventivo.assegnato_a}</strong>
        </div>
      </div>
    ` : ''}
 
    <div class="flex justify-between items-center mt-6">
  <div>
    ${canEdit ? `
      <button id="deleteBtn" class="px-4 py-2 bg-red-500 text-white rounded">
        <i class="fas fa-trash mr-1"></i>Elimina Preventivo
      </button>
    ` : ''}
  </div>
  <div class="flex gap-2">
    <button id="cancelBtn" class="px-4 py-2 border rounded">Chiudi</button>
    ${canEdit ? `
      <button id="saveBtn" class="px-4 py-2 bg-blue-500 text-white rounded">Salva Modifiche</button>
    ` : ''}
  </div>
</div>
  `;
  
  wrap.appendChild(card);
  document.body.appendChild(wrap);

  // Carica allegati richiesta
  loadAttachmentsPrev(preventivo.id, 'richiesta', $('#allegatiRichiesta', card));

  // Carica allegati preventivo
  loadAttachmentsPrev(preventivo.id, 'preventivo', $('#allegatiPreventivo', card));

  // Upload preventivo (solo chi ha scope preventivi)
  if (canEdit) {
    const fileInput = $('#fileInputPreventivo', card);
if (fileInput) {
  // Imposta accept attribute per limitare i tipi di file
  fileInput.setAttribute('accept', '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.zip,.rar');
  
  fileInput.addEventListener('change', async (e) => {
    const files = e.target.files;
    for (const file of files) {
      if (file.size > 20 * 1024 * 1024) {
        notify(`File troppo grande (max 20MB): ${file.name}`, 'error');
        continue;
      }
      
      // Validazione tipo file
      const allowedExtensions = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.zip', '.rar'];
      const fileName = file.name.toLowerCase();
      const hasValidExtension = allowedExtensions.some(ext => fileName.endsWith(ext));
      
      if (!hasValidExtension) {
        notify(`Formato non supportato: ${file.name}`, 'error');
        continue;
      }
      
      await uploadFilePrev(file, preventivo.id, 'preventivo');
    }
    loadAttachmentsPrev(preventivo.id, 'preventivo', $('#allegatiPreventivo', card));
    e.target.value = '';
  });
}

    const saveBtn = $('#saveBtn', card);
if (saveBtn) {
  saveBtn.addEventListener('click', async () => {
    const body = {
      stato: $('#statoSelect', card).value
    };
    
    // 🆕 Aggiungi note preventivista se modificate
    const noteField = $('#notePreventivista', card);
    if (noteField) {
      body.note_preventivista = noteField.value || null;
    }
    
    await api('put', `/api/preventivi/${preventivo.id}`, body);
    notify('Preventivo aggiornato', 'success');
    wrap.remove();
    renderPreventivi();
  });
}
  }


//  prova per cancellare
const deleteBtn = $('#deleteBtn', card);
if (deleteBtn) {
  deleteBtn.addEventListener('click', async () => {
    if (await confirmBox('Eliminare definitivamente questo preventivo e tutti gli allegati collegati?')) {
      try {
        await api('delete', `/api/preventivi/${preventivo.id}`);
        notify('Preventivo eliminato con successo', 'success');
        wrap.remove();
        renderPreventivi();
      } catch (error) {
        console.error('Errore eliminazione preventivo:', error);
        notify('Errore durante l\'eliminazione', 'error');
      }
    }
  });
}
  $('#closeModal', card).addEventListener('click', () => wrap.remove());
  $('#cancelBtn', card).addEventListener('click', () => wrap.remove());
   const prendiInCaricoBtn = $('#prendiInCaricoBtn', card);
  if (prendiInCaricoBtn) {
    prendiInCaricoBtn.addEventListener('click', async () => {
      if (!confirm('Vuoi prendere in carico questa richiesta di preventivo?')) return;
      
      try {
        await api('post', `/api/preventivi/${preventivo.id}/assegna`);
        notify('Preventivo preso in carico con successo!', 'success');
        wrap.remove();
        renderPreventivi();
      } catch (error) {
        console.error('Errore presa in carico:', error);
        notify(error.message || 'Errore durante la presa in carico', 'error');
      }
    });
  }
}

/* Helper upload file preventivi */
async function uploadFilePrev(file, preventivoId, tipo) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1];
    await api('post', '/api/attachments', {
      preventivo_id: preventivoId,
      tipo_allegato: tipo,
      filename: file.name,
      mime_type: file.type,
      size: file.size,
      data_base64: base64
    });
  };
  reader.readAsDataURL(file);
}

/* Helper carica allegati preventivi */
async function loadAttachmentsPrev(preventivoId, tipo, container) {
  try {
    const { attachments } = await api('get', `/api/attachments?preventivo_id=${preventivoId}`);
    const filtered = attachments.filter(a => a.tipo_allegato === tipo);
    
    container.innerHTML = filtered.length ? filtered.map(a => `
      <div class="flex items-center justify-between p-2 bg-white border rounded mb-1">
        <div class="flex items-center gap-2">
          <i class="fas fa-file text-gray-500"></i>
          <a href="${a.url}" target="_blank" class="text-blue-600 hover:underline text-sm">${a.filename}</a>
          <span class="text-xs text-gray-500">(${formatFileSize(a.size)})</span>
        </div>
      </div>
    `).join('') : '<div class="text-sm text-gray-500">Nessun allegato</div>';
  } catch (e) {
    container.innerHTML = '<div class="text-sm text-red-500">Errore caricamento</div>';
  }
}
  
  /* ---------- Rilievi ---------- */
  async function renderRilievi() {
    const main = $('#main');
    const today = new Date();
    const currentMonth = today.getMonth();
    const currentYear = today.getFullYear();
    
    main.innerHTML = `
  <div class="flex justify-between items-center mb-4">
    <h2 class="text-xl font-semibold"><i class="fas fa-ruler-combined mr-2"></i>Rilievi</h2>
    <div class="flex gap-2">
      <input id="searchRilievi" class="p-2 border rounded" placeholder="Cerca cliente..." />
          <button id="viewToggle" class="px-3 py-2 border rounded">
            <i class="fas fa-calendar-alt"></i> Vista Calendario
          </button>
        </div>
      </div>
      
      <div id="calendarView" style="display: none;">
        <div class="bg-white rounded-lg shadow p-4">
          <div class="flex justify-between items-center mb-4">
            <button id="prevMonth" class="px-3 py-1 border rounded"><i class="fas fa-chevron-left"></i></button>
            <h3 id="monthYear" class="text-lg font-semibold"></h3>
            <button id="nextMonth" class="px-3 py-1 border rounded"><i class="fas fa-chevron-right"></i></button>
          </div>
          <div id="calendar"></div>
        </div>
      </div>
      
      <div id="listView">
        <div id="rilievi_list" class="grid md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
      </div>
    `;

    let viewMode = 'list';
    let selectedMonth = currentMonth;
    let selectedYear = currentYear;
    let rilieviAll = [];

    const loadRilievi = async () => {
      const { rilievi } = await api('get', '/api/rilievi');
      rilieviAll = rilievi || [];
      updateView();
    };

// Popola filtro province
const provinces = [...new Set(rilieviAll.map(r => r.provincia).filter(Boolean))].sort();
const provSelect = $('#filter_provincia_rilievi');
if (provSelect) {
  provSelect.innerHTML = `<option value="">Tutte le province</option>` +
    provinces.map(p => `<option value="${p}">${p}</option>`).join('');
}

// Funzione filtri
const applyFilters = () => {
  const searchText = ($('#searchRilievi')?.value || '').toLowerCase();
  const filterCliente = ($('#filter_cliente_rilievi')?.value || '').toLowerCase();
  const filterStato = $('#filter_stato_rilievi')?.value || '';
  const filterProvincia = $('#filter_provincia_rilievi')?.value || '';
  const filterDataContratto = $('#filter_data_contratto_rilievi')?.value || '';
  
  let filtered = rilieviAll.filter(r => {
    const matchSearch = !searchText || (r.cliente || '').toLowerCase().includes(searchText);
    const matchCliente = !filterCliente || (r.cliente || '').toLowerCase().includes(filterCliente);
    const matchStato = !filterStato || r.stato === filterStato;
    const matchProvincia = !filterProvincia || r.provincia === filterProvincia;
    const matchData = !filterDataContratto || r.data_contratto === filterDataContratto;
    
    return matchSearch && matchCliente && matchStato && matchProvincia && matchData;
  });
  
  rilieviAll = filtered;
  updateView();
};

$('#searchRilievi')?.addEventListener('input', applyFilters);
$('#filter_cliente_rilievi')?.addEventListener('input', applyFilters);
$('#filter_stato_rilievi')?.addEventListener('change', applyFilters);
$('#filter_provincia_rilievi')?.addEventListener('change', applyFilters);
$('#filter_data_contratto_rilievi')?.addEventListener('change', applyFilters);

$('#clear_filters_rilievi')?.addEventListener('click', () => {
  if ($('#searchRilievi')) $('#searchRilievi').value = '';
  if ($('#filter_cliente_rilievi')) $('#filter_cliente_rilievi').value = '';
  if ($('#filter_stato_rilievi')) $('#filter_stato_rilievi').value = '';
  if ($('#filter_provincia_rilievi')) $('#filter_provincia_rilievi').value = '';
  if ($('#filter_data_contratto_rilievi')) $('#filter_data_contratto_rilievi').value = '';
  loadRilievi();
});

    const updateView = () => {
      if (viewMode === 'calendar') {
        renderCalendarRilievi();
      } else {
        renderListRilievi();
      }
    };

    const renderListRilievi = () => {
      $('#calendarView').style.display = 'none';
      $('#listView').style.display = 'block';
      $('#viewToggle').innerHTML = '<i class="fas fa-calendar-alt"></i> Vista Calendario';

      const list = $('#rilievi_list');
      if (!rilieviAll.length) {
        list.innerHTML = `<div class="bg-white rounded-lg shadow p-6 col-span-3 text-gray-600">Nessun rilievo</div>`;
        return;
      }

      // Raggruppa per stato
      const daProgrammare = rilieviAll.filter(r => r.stato === 'da programmare');
      const programmati = rilieviAll.filter(r => r.stato === 'rilievo programmato');
      const eseguiti = rilieviAll.filter(r => r.stato === 'rilievo eseguito');

      list.innerHTML = `
        ${daProgrammare.length ? `
          <div class="col-span-full">
            <h3 class="text-lg font-semibold mb-3 text-orange-600">
              <i class="fas fa-exclamation-circle mr-2"></i>Da Programmare (${daProgrammare.length})
            </h3>
            <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              ${daProgrammare.map(renderRilievoCard).join('')}
            </div>
          </div>
        ` : ''}
        
        ${programmati.length ? `
          <div class="col-span-full mt-6">
            <h3 class="text-lg font-semibold mb-3 text-blue-600">
              <i class="fas fa-calendar-check mr-2"></i>Programmati (${programmati.length})
            </h3>
            <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              ${programmati.map(renderRilievoCard).join('')}
            </div>
          </div>
        ` : ''}
        
        ${eseguiti.length ? `
          <div class="col-span-full mt-6">
            <h3 class="text-lg font-semibold mb-3 text-green-600">
              <i class="fas fa-check-circle mr-2"></i>Eseguiti (${eseguiti.length})
            </h3>
            <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              ${eseguiti.map(renderRilievoCard).join('')}
            </div>
          </div>
        ` : ''}
      `;

      // Event handlers

      // Gestione bottoni azione

      $$('[data-action]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation(); // Ferma propagazione per non aprire modal vecchia
          const action = btn.dataset.action;
          const id = btn.dataset.rilievoId;
          
          if (action === 'execute') {
  // Esegui Rilievo -> apre modal multi-step
  await openEseguiRilievoModal(id, false);
} else if (action === 'view') {
  // Visualizza Rilievo -> apre modal multi-step in sola lettura
  await openEseguiRilievoModal(id, true);
} else if (action === 'pdf') {
  // Scarica PDF
  const newWindow = window.open(`/api/rilievi/${id}/pdf`, '_blank');
  if (!newWindow) {
    notify('Abilita i popup per generare il PDF', 'warn');
  } else {
    setTimeout(() => {
      newWindow.print();
    }, 1000);
  }
}
        });
      });

      // Click sulla card (area non bottoni) -> apre modal programmazione

      $$('[data-rilievo-id]').forEach(card => {
        card.addEventListener('click', async (e) => {
          // Solo se non è un click su bottone
          if (!e.target.closest('[data-action]')) {
            const id = card.dataset.rilievoId;
            const { rilievo, preventivi } = await api('get', `/api/rilievi/${id}`);
            openRilievoModal(rilievo, preventivi);
          }
        });
      });
    };

const renderRilievoCard = (r) => {
      const statoBadge = getStatoRilievoBadge(r.stato);
      const isEseguito = r.stato === 'rilievo eseguito';
      return `
        <div class="bg-white rounded-lg shadow p-4 hover:shadow-lg transition border-l-4 ${getStatoRilievoBorder(r.stato)}" 
             data-rilievo-id="${r.id}">
          <div class="flex justify-between items-start mb-3">
            <div class="flex-1">
              <div class="font-semibold text-lg">${r.cliente || 'Cliente sconosciuto'}</div>
              <div class="text-sm text-gray-500">${r.provincia || ''}</div>
            </div>
            <span class="px-2 py-1 rounded text-xs ${statoBadge}">${r.stato.replace(/_/g, ' ')}</span>
          </div>

          ${r.data_rilievo ? `
            <div class="text-sm text-gray-600 mb-2">
              <i class="far fa-calendar mr-1"></i>${fmtDate(r.data_rilievo)} 
              ${r.ora_rilievo ? r.ora_rilievo.substring(0, 5) : ''}
            </div>
          ` : ''}

          ${r.tecnico_nome ? `
            <div class="text-sm text-gray-600 mb-2">
              <i class="fas fa-user mr-1"></i>${r.tecnico_nome}
            </div>
          ` : ''}

          ${r.cliente_telefono ? `
            <div class="text-sm text-gray-600 mb-2">
              <i class="fas fa-phone mr-1"></i>${r.cliente_telefono}
            </div>
          ` : ''}

          ${r.cliente_indirizzo ? `
            <div class="text-sm text-gray-600 mb-2">
              <i class="fas fa-map-marker-alt mr-1"></i>${r.cliente_indirizzo}
            </div>
          ` : ''}

          ${r.allegato ? `
            <div class="mt-2 text-sm text-green-600">
              <i class="fas fa-paperclip mr-1"></i>Allegato presente
            </div>
          ` : ''}

          <!-- Pulsanti azione -->
          <div class="mt-4 flex gap-2">
            <button 
              class="flex-1 px-3 py-2 ${isEseguito ? 'bg-blue-500' : 'bg-green-500'} text-white rounded hover:opacity-90 transition"
              data-action="${isEseguito ? 'view' : 'execute'}"
              data-rilievo-id="${r.id}">
              <i class="fas ${isEseguito ? 'fa-eye' : 'fa-clipboard-check'} mr-1"></i>
              ${isEseguito ? 'Visualizza Rilievo' : 'Esegui Rilievo'}
            </button>
            ${isEseguito ? `
              <button 
                class="px-3 py-2 bg-red-500 text-white rounded hover:opacity-90 transition"
                data-action="pdf"
                data-rilievo-id="${r.id}">
                <i class="fas fa-file-pdf"></i>
              </button>
            ` : ''}
          </div>
        </div>
      `;
    };

    const getStatoRilievoBadge = (stato) => {
      const colors = {
        'da programmare': 'bg-orange-100 text-orange-800',
        'rilievo programmato': 'bg-blue-100 text-blue-800',
        'rilievo eseguito': 'bg-green-100 text-green-800'
      };
      return colors[stato] || 'bg-gray-100';
    };

    const getStatoRilievoBorder = (stato) => {
      const colors = {
        'da programmare': 'border-orange-500',
        'rilievo programmato': 'border-blue-500',
        'rilievo eseguito': 'border-green-500'
      };
      return colors[stato] || 'border-gray-300';
    };

    const renderCalendarRilievi = () => {
      $('#calendarView').style.display = 'block';
      $('#listView').style.display = 'none';
      $('#viewToggle').innerHTML = '<i class="fas fa-list"></i> Vista Lista';

      const monthNames = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
      $('#monthYear').textContent = `${monthNames[selectedMonth]} ${selectedYear}`;

      const firstDay = new Date(selectedYear, selectedMonth, 1).getDay();
      const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
      const adjustedFirstDay = firstDay === 0 ? 6 : firstDay - 1;

      // Filtra solo rilievi programmati per il calendario
      const programmati = rilieviAll.filter(r => r.stato === 'rilievo programmato');

      let html = `
        <div class="grid grid-cols-7 gap-0 border text-xs sm:text-sm">
          <div class="p-2 bg-gray-100 font-semibold text-center border">Lun</div>
          <div class="p-2 bg-gray-100 font-semibold text-center border">Mar</div>
          <div class="p-2 bg-gray-100 font-semibold text-center border">Mer</div>
          <div class="p-2 bg-gray-100 font-semibold text-center border">Gio</div>
          <div class="p-2 bg-gray-100 font-semibold text-center border">Ven</div>
          <div class="p-2 bg-gray-100 font-semibold text-center border">Sab</div>
          <div class="p-2 bg-gray-100 font-semibold text-center border">Dom</div>
      `;

      for (let i = 0; i < adjustedFirstDay; i++) {
        html += '<div class="border min-h-[100px] p-2 bg-gray-50"></div>';
      }

      for (let day = 1; day <= daysInMonth; day++) {
        const dayRilievi = programmati.filter(r => {
          if (!r.data_rilievo) return false;
          const d = new Date(r.data_rilievo);
          return d.getDate() === day && d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
        }).sort((a, b) => (a.ora_rilievo || '').localeCompare(b.ora_rilievo || ''));

        const isToday = day === today.getDate() && selectedMonth === currentMonth && selectedYear === currentYear;

        html += `
          <div class="border min-h-[120px] p-2 ${isToday ? 'bg-blue-50' : ''} hover:bg-gray-50">
            <div class="flex items-center justify-between mb-1">
              <div class="font-semibold">${day}</div>
              ${dayRilievi.length ? `<span class="text-xs text-gray-500">${dayRilievi.length}</span>` : ''}
            </div>
            <div class="space-y-1 text-xs max-h-40 overflow-y-auto">
              ${dayRilievi.map(r => `
                <div class="p-1 rounded cursor-pointer bg-blue-100 border-l-2 border-blue-500"
                     onclick="window.openRilievoModalById(${r.id})">
                  <div class="font-semibold truncate">${r.ora_rilievo ? r.ora_rilievo.substring(0,5) : ''} ${r.cliente || ''}</div>
                  ${r.provincia ? `<div class="text-xs text-gray-600">${r.provincia}</div>` : ''}
                  ${r.tecnico_nome ? `<div class="text-xs text-gray-600">${r.tecnico_nome}</div>` : ''}
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      html += '</div>';
      $('#calendar').innerHTML = html;
    };

    // Esponi funzione globale per onclick nel calendario
    window.openRilievoModalById = async (id) => {
      const { rilievo, preventivi } = await api('get', `/api/rilievi/${id}`);
      openRilievoModal(rilievo, preventivi);
    };

    $('#viewToggle').addEventListener('click', () => {
      viewMode = viewMode === 'list' ? 'calendar' : 'list';
      updateView();
    });

    $('#prevMonth')?.addEventListener('click', () => {
      selectedMonth--;
      if (selectedMonth < 0) { selectedMonth = 11; selectedYear--; }
      renderCalendarRilievi();
    });

    $('#nextMonth')?.addEventListener('click', () => {
      selectedMonth++;
      if (selectedMonth > 11) { selectedMonth = 0; selectedYear++; }
      renderCalendarRilievi();
    });


    await loadRilievi();
  }

  /* ---------- Modale Dettaglio Rilievo ---------- */

  /* ---------- GENERA SCHIZZO SVG FINESTRA ---------- */
  function generateFinestraSVG(finestra) {
    const { tipo, numero_ante, tipo_apertura, altezza, larghezza, tapparella, cassonetto, zanzariera, stanza } = finestra;
    
    // Dimensioni SVG
    const svgWidth = 400;
    const svgHeight = 300;
    const margin = 40;
    
    // Scala finestra per adattarla al canvas
    const maxWidth = svgWidth - margin * 2;
    const maxHeight = svgHeight - margin * 2 - (tapparella === 'si' ? 40 : 0);
    
    const scale = Math.min(maxWidth / (larghezza || 100), maxHeight / (altezza || 100));
    const finestraWidth = (larghezza || 100) * scale;
    const finestraHeight = (altezza || 100) * scale;
    
    const startX = (svgWidth - finestraWidth) / 2;
    let startY = margin + (tapparella === 'si' ? 40 : 0);
    
    let svg = `<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg">`;
    
    // Sfondo
    svg += `<rect width="${svgWidth}" height="${svgHeight}" fill="#f9fafb"/>`;
    
    // Tapparella (se presente)
    if (tapparella === 'si') {
      const tappHeight = 30;
      const tappY = startY - 35;
      svg += `<rect x="${startX}" y="${tappY}" width="${finestraWidth}" height="${tappHeight}" fill="#9ca3af" stroke="#4b5563" stroke-width="2" rx="3"/>`;
      svg += `<line x1="${startX}" y1="${tappY + 5}" x2="${startX + finestraWidth}" y2="${tappY + 5}" stroke="#6b7280" stroke-width="1"/>`;
      svg += `<line x1="${startX}" y1="${tappY + 10}" x2="${startX + finestraWidth}" y2="${tappY + 10}" stroke="#6b7280" stroke-width="1"/>`;
      svg += `<line x1="${startX}" y1="${tappY + 15}" x2="${startX + finestraWidth}" y2="${tappY + 15}" stroke="#6b7280" stroke-width="1"/>`;
      svg += `<line x1="${startX}" y1="${tappY + 20}" x2="${startX + finestraWidth}" y2="${tappY + 20}" stroke="#6b7280" stroke-width="1"/>`;
      svg += `<line x1="${startX}" y1="${tappY + 25}" x2="${startX + finestraWidth}" y2="${tappY + 25}" stroke="#6b7280" stroke-width="1"/>`;
      
      // Label Tapparella
      svg += `<text x="${startX + finestraWidth / 2}" y="${tappY - 5}" font-size="11" font-weight="bold" text-anchor="middle" fill="#374151">TAPPARELLA</text>`;
    }
    
    // Cornice finestra
    svg += `<rect x="${startX}" y="${startY}" width="${finestraWidth}" height="${finestraHeight}" fill="#fff" stroke="#1f2937" stroke-width="3"/>`;
    
    // Dividi in ante
    const anteLarghezza = finestraWidth / numero_ante;
    
    for (let i = 0; i < numero_ante; i++) {
      const antaX = startX + i * anteLarghezza;
      
      // Disegna anta
      svg += `<rect x="${antaX + 2}" y="${startY + 2}" width="${anteLarghezza - 4}" height="${finestraHeight - 4}" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/>`;
      
      // Vetro
      const vetroMargin = 15;
      svg += `<rect x="${antaX + vetroMargin}" y="${startY + vetroMargin}" width="${anteLarghezza - vetroMargin * 2}" height="${finestraHeight - vetroMargin * 2}" fill="#bfdbfe" stroke="#3b82f6" stroke-width="1" opacity="0.3"/>`;
      
      // Maniglia
      const manigliaX = antaX + anteLarghezza - 20;
      const manigliaY = startY + finestraHeight / 2;
      svg += `<circle cx="${manigliaX}" cy="${manigliaY}" r="5" fill="#4b5563"/>`;
      
      // Simbolo apertura (semplificato - frecce)
      const apertura = tipo_apertura?.toLowerCase() || '';
      
      if (apertura.includes('battente dx') || apertura.includes('destra')) {
        // Freccia verso destra
        const arrowX = antaX + anteLarghezza / 2;
        const arrowY = startY + finestraHeight / 2;
        svg += `<path d="M ${arrowX - 15} ${arrowY} L ${arrowX + 15} ${arrowY} M ${arrowX + 10} ${arrowY - 5} L ${arrowX + 15} ${arrowY} L ${arrowX + 10} ${arrowY + 5}" stroke="#ef4444" stroke-width="2" fill="none"/>`;
      } else if (apertura.includes('battente sx') || apertura.includes('sinistra')) {
        // Freccia verso sinistra
        const arrowX = antaX + anteLarghezza / 2;
        const arrowY = startY + finestraHeight / 2;
        svg += `<path d="M ${arrowX + 15} ${arrowY} L ${arrowX - 15} ${arrowY} M ${arrowX - 10} ${arrowY - 5} L ${arrowX - 15} ${arrowY} L ${arrowX - 10} ${arrowY + 5}" stroke="#ef4444" stroke-width="2" fill="none"/>`;
      } else if (apertura.includes('scorrevole')) {
        // Doppia freccia orizzontale
        const arrowX = antaX + anteLarghezza / 2;
        const arrowY = startY + finestraHeight / 2;
        svg += `<path d="M ${arrowX - 20} ${arrowY} L ${arrowX + 20} ${arrowY} M ${arrowX - 15} ${arrowY - 5} L ${arrowX - 20} ${arrowY} L ${arrowX - 15} ${arrowY + 5} M ${arrowX + 15} ${arrowY - 5} L ${arrowX + 20} ${arrowY} L ${arrowX + 15} ${arrowY + 5}" stroke="#3b82f6" stroke-width="2" fill="none"/>`;
      } else if (apertura.includes('vasistas')) {
        // Freccia verso l'alto
        const arrowX = antaX + anteLarghezza / 2;
        const arrowY = startY + finestraHeight / 2;
        svg += `<path d="M ${arrowX} ${arrowY + 15} L ${arrowX} ${arrowY - 15} M ${arrowX - 5} ${arrowY - 10} L ${arrowX} ${arrowY - 15} L ${arrowX + 5} ${arrowY - 10}" stroke="#10b981" stroke-width="2" fill="none"/>`;
      } else if (apertura.includes('fisso')) {
        // X per indicare fisso
        const centerX = antaX + anteLarghezza / 2;
        const centerY = startY + finestraHeight / 2;
        const size = 15;
        svg += `<line x1="${centerX - size}" y1="${centerY - size}" x2="${centerX + size}" y2="${centerY + size}" stroke="#6b7280" stroke-width="2"/>`;
        svg += `<line x1="${centerX + size}" y1="${centerY - size}" x2="${centerX - size}" y2="${centerY + size}" stroke="#6b7280" stroke-width="2"/>`;
      }
    }
    
    // Zanzariera (se presente)
    if (zanzariera) {
      svg += `<text x="${startX + finestraWidth + 10}" y="${startY + 20}" font-size="10" fill="#059669" font-weight="bold">🦟 ${zanzariera}</text>`;
    }
    
    // Cassonetto (se presente)
    if (cassonetto === 'si') {
      svg += `<text x="${startX - 10}" y="${startY - 10}" font-size="10" fill="#7c3aed" font-weight="bold">📦 Cassonetto</text>`;
    }
    
    // Misure
    // Altezza (lato sinistro)
    const altezzaLabelX = startX - 25;
    const altezzaLabelY = startY + finestraHeight / 2;
    svg += `<line x1="${altezzaLabelX}" y1="${startY}" x2="${altezzaLabelX}" y2="${startY + finestraHeight}" stroke="#1f2937" stroke-width="1" marker-start="url(#arrow)" marker-end="url(#arrow)"/>`;
    svg += `<text x="${altezzaLabelX - 5}" y="${altezzaLabelY + 4}" font-size="12" font-weight="bold" text-anchor="end" fill="#1f2937">H: ${altezza}cm</text>`;
    
    // Larghezza (sotto)
    const larghezzaLabelY = startY + finestraHeight + 20;
    const larghezzaLabelX = startX + finestraWidth / 2;
    svg += `<line x1="${startX}" y1="${larghezzaLabelY - 5}" x2="${startX + finestraWidth}" y2="${larghezzaLabelY - 5}" stroke="#1f2937" stroke-width="1" marker-start="url(#arrow)" marker-end="url(#arrow)"/>`;
    svg += `<text x="${larghezzaLabelX}" y="${larghezzaLabelY + 10}" font-size="12" font-weight="bold" text-anchor="middle" fill="#1f2937">L: ${larghezza}cm</text>`;
    
    // Tipo e Stanza (titolo)
    const tipoLabel = tipo === 'finestra' ? 'FINESTRA' : tipo === 'porta-finestra' ? 'PORTA-FINESTRA' : tipo === 'portoncino' ? 'PORTONCINO' : 'PORTA';
    svg += `<text x="${svgWidth / 2}" y="20" font-size="14" font-weight="bold" text-anchor="middle" fill="#1f2937">${tipoLabel}${stanza ? ' - ' + stanza.toUpperCase() : ''}</text>`;
    
    // Arrow markers
    svg += `<defs>
      <marker id="arrow" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto" markerUnits="strokeWidth">
        <path d="M 0 0 L 5 5 L 0 10 L 5 5 L 10 10 L 5 5 L 10 0 Z" fill="#1f2937"/>
      </marker>
    </defs>`;
    
    svg += `</svg>`;
    
    return svg;
  }
  async function openRilievoModal(rilievo, preventivi = []) {
    const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
    const card = el('div', { class: 'bg-white p-6 rounded-lg w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-xl' });

    const tecniciOptions = [
      { id: '', nome: '-- Seleziona tecnico --' },
      ...(state.vendors || []).filter(v => ['cosimo','giada'].includes((v.username || '').toLowerCase()))
    ];

    card.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold">
          <i class="fas fa-ruler-combined mr-2"></i>Rilievo #${rilievo.id}
        </h3>
        <button id="closeModal" class="text-gray-500 hover:text-gray-700">
          <i class="fas fa-times"></i>
        </button>
      </div>

      <!-- Info Cliente -->
      <div class="grid md:grid-cols-2 gap-4 mb-4">
        <div class="p-3 bg-gray-50 rounded">
          <div class="text-sm text-gray-600">Cliente</div>
          <div class="font-semibold">${rilievo.cliente || 'N/A'}</div>
          ${rilievo.cliente_telefono ? `<div class="text-sm"><i class="fas fa-phone mr-1"></i>${rilievo.cliente_telefono}</div>` : ''}
          ${rilievo.cliente_email ? `<div class="text-sm"><i class="fas fa-envelope mr-1"></i>${rilievo.cliente_email}</div>` : ''}
          ${rilievo.cliente_indirizzo ? `<div class="text-sm mt-1"><i class="fas fa-map-marker-alt mr-1"></i>${rilievo.cliente_indirizzo}</div>` : ''}
        </div>
        <div class="p-3 bg-gray-50 rounded">
          <div class="text-sm text-gray-600">Stato</div>
          <select id="statoSelect" class="p-2 border rounded w-full mt-1">
            <option value="da programmare" ${rilievo.stato === 'da programmare' ? 'selected' : ''}>Da programmare</option>
            <option value="rilievo programmato" ${rilievo.stato === 'rilievo programmato' ? 'selected' : ''}>Rilievo programmato</option>
            <option value="rilievo eseguito" ${rilievo.stato === 'rilievo eseguito' ? 'selected' : ''}>Rilievo eseguito</option>
          </select>
        </div>
      </div>

      <!-- Programmazione Rilievo -->
      <div class="mb-4 p-4 bg-blue-50 rounded border-l-4 border-blue-500">
        <h4 class="font-semibold mb-3"><i class="fas fa-calendar-alt mr-2"></i>Programmazione</h4>
        <div class="grid md:grid-cols-3 gap-3">
          <div>
            <label class="text-xs text-gray-600">Data rilievo</label>
            <input type="date" id="dataRilievo" class="p-2 border rounded w-full" value="${rilievo.data_rilievo || ''}" />
          </div>
          <div>
            <label class="text-xs text-gray-600">Ora</label>
            <input type="time" id="oraRilievo" class="p-2 border rounded w-full" value="${rilievo.ora_rilievo || ''}" />
          </div>
          <div>
            <label class="text-xs text-gray-600">Tecnico</label>
            <select id="tecnicoSelect" class="p-2 border rounded w-full">
              ${tecniciOptions.map(t => `<option value="${t.id}" ${rilievo.tecnico_id == t.id ? 'selected' : ''}>${t.nome_completo || t.nome}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <!-- Prodotti e Quantità -->
      ${(() => {
        console.log('🔍 DEBUG COMPLETO rilievo:', rilievo);
        console.log('🔍 prodotti_venduti:', rilievo.prodotti_venduti);
        console.log('🔍 tipo:', typeof rilievo.prodotti_venduti);
        
        if (!rilievo.prodotti_venduti || rilievo.prodotti_venduti === 'null') {
          console.warn('⚠️ prodotti_venduti è vuoto');
          return '<div class="mb-4 p-3 bg-yellow-50 rounded"><p class="text-sm">ℹ️ Nessun prodotto venduto registrato.</p></div>';
        }
        
        try {
          let prodotti;
          if (Array.isArray(rilievo.prodotti_venduti)) {
            prodotti = rilievo.prodotti_venduti;
          } else if (typeof rilievo.prodotti_venduti === 'string') {
            prodotti = JSON.parse(rilievo.prodotti_venduti);
          } else {
            return '';
          }
          
          if (!Array.isArray(prodotti) || prodotti.length === 0) return '';
          
          const quantita = rilievo.prodotti_quantita ? JSON.parse(rilievo.prodotti_quantita) : {};
          const productLabels = {
            'infissi': 'Infissi', 'tapparelle': 'Tapparelle', 'zanzariere': 'Zanzariere',
            'porte_blindate': 'Porte Blindate', 'scuri_persiane': 'Scuri/Persiane',
            'scuri': 'Scuri', 'tende': 'Tende', 'altro': 'Altro'
          };
          
          return '<div class="mb-4 p-4 bg-purple-50 rounded border-l-4 border-purple-500">' +
            '<h4 class="font-semibold mb-3"><i class="fas fa-boxes mr-2"></i>Prodotti e Quantità</h4>' +
            '<div class="grid md:grid-cols-2 gap-3">' +
            prodotti.map(p => 
              '<div><label class="text-sm font-medium text-gray-700">' + (productLabels[p] || p) + '</label>' +
              '<input type="number" class="p-2 border rounded w-full mt-1 prodotto-quantita" ' +
              'data-prodotto="' + p + '" value="' + (quantita[p] || '') + '" min="1" placeholder="Numero pezzi" /></div>'
            ).join('') +
            '</div></div>';
        } catch (e) {
          console.error('❌ ERRORE:', e);
          return '<div class="mb-4 p-3 bg-red-50 rounded"><p class="text-sm text-red-600">⚠️ Errore. Controlla console F12.</p></div>';
        }
      })()}
      <!-- Preventivi Cliente -->
      ${preventivi.length ? `
        <div class="mb-4 p-4 bg-green-50 rounded border-l-4 border-green-500">
          <h4 class="font-semibold mb-3"><i class="fas fa-file-invoice mr-2"></i>Preventivi Cliente</h4>
          <div class="space-y-2">
            ${preventivi.map(p => `
              <div class="flex justify-between items-center bg-white p-2 rounded border">
                <div>
                  <div class="font-medium">Preventivo #${p.id}</div>
                  <div class="text-xs text-gray-500">${fmtDT(p.created_at)}</div>
                </div>
                <span class="px-2 py-1 rounded text-xs ${getStatoBadge(p.stato)}">${p.stato.replace(/_/g, ' ')}</span>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <!-- Note Cliente -->
      ${rilievo.cliente_note ? `
        <div class="mb-4 p-3 bg-yellow-50 rounded border-l-4 border-yellow-500">
          <div class="text-sm font-medium mb-1">Note cliente:</div>
          <div class="text-sm">${rilievo.cliente_note}</div>
        </div>
      ` : ''}

      <!-- Note Rilievo -->
      <div class="mb-4">
        <label class="block text-sm font-medium mb-1">Note rilievo</label>
        <textarea id="noteRilievo" rows="3" class="p-2 border rounded w-full">${rilievo.note || ''}</textarea>
      </div>
      
	   <!-- Tempo Stimato Montaggio -->
    <div class="mb-4">
      <label class="block text-sm font-medium mb-1">
        <i class="fas fa-clock mr-1 text-blue-500"></i>Tempo stimato per montaggio
      </label>
      <input type="text" id="tempoStimatoMontaggio" 
             class="p-2 border rounded w-full" 
             placeholder="es. 2 ore, 3-4 ore, mezza giornata" 
             value="${rilievo.tempo_stimato_montaggio || ''}" />
      <p class="text-xs text-gray-500 mt-1">Inserisci una stima del tempo necessario per il montaggio</p>
    </div>
	
      <!-- Allegato (OBBLIGATORIO per completare) -->
      <div class="mb-4 p-4 ${rilievo.allegato ? 'bg-green-50 border-green-500' : 'bg-orange-50 border-orange-500'} rounded border-l-4">
        <h4 class="font-semibold mb-2">
          <i class="fas fa-paperclip mr-2"></i>Allegato Rilievo 
         <span class="text-xs font-normal ${rilievo.allegato ? 'text-green-600' : 'text-gray-600'}">
  ${rilievo.allegato ? '(Presente)' : '(Opzionale)'}
</span>
          </span>
        </h4>
        
        ${rilievo.allegato ? `
          <div class="bg-white p-2 rounded border mb-2 flex items-center justify-between">
            <div class="flex items-center gap-2">
              <i class="fas fa-file text-gray-500"></i>
              <a href="/api/rilievi/${rilievo.id}/allegato" target="_blank" class="text-blue-600 hover:underline">
                ${rilievo.allegato_nome || 'Scarica allegato'}
              </a>
            </div>
            <button id="removeAttachment" class="text-red-500 hover:bg-red-50 p-1 rounded">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        ` : ''}
        
        <input type="file" id="fileInputRilievo" 
               accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx" 
               class="p-2 border rounded w-full" />
        <div class="text-xs text-gray-500 mt-1">
          Formati: PDF, Immagini, Word, Excel (max 20MB)
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <button id="cancelBtn" class="px-4 py-2 border rounded">Annulla</button>
        <button id="saveBtn" class="px-4 py-2 bg-blue-500 text-white rounded">Salva Modifiche</button>
      </div>
    `;

    wrap.appendChild(card);
    document.body.appendChild(wrap);

    let newAttachment = null;

    // Handler caricamento file
    $('#fileInputRilievo', card).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      if (file.size > 20 * 1024 * 1024) {
        notify('File troppo grande (max 20MB)', 'error');
        e.target.value = '';
        return;
      }

      const reader = new FileReader();
      reader.onload = (evt) => {
        newAttachment = {
          data: evt.target.result.split(',')[1],
          nome: file.name,
          tipo: file.type
        };
        notify('File pronto per il caricamento', 'success');
      };
      reader.readAsDataURL(file);
    });

    // Handler rimozione allegato
    $('#removeAttachment', card)?.addEventListener('click', async () => {
      if (await confirmBox('Rimuovere l\'allegato esistente?')) {
        newAttachment = { data: null, nome: null, tipo: null };
        notify('Allegato rimosso (salva per confermare)', 'info');
      }
    });

    $('#closeModal', card).addEventListener('click', () => wrap.remove());
    $('#cancelBtn', card).addEventListener('click', () => wrap.remove());

    $('#saveBtn', card).addEventListener('click', async () => {
       const body = {
        stato: $('#statoSelect', card).value,
        data_rilievo: $('#dataRilievo', card).value || null,
        ora_rilievo: $('#oraRilievo', card).value || null,
        tecnico_id: Number($('#tecnicoSelect', card).value) || null,
note: $('#noteRilievo', card).value || null,
tempo_stimato_montaggio: $('#tempoStimatoMontaggio', card).value || null
      };

      // Raccog li quantità prodotti
      const quantitaInputs = $$('.prodotto-quantita', card);
      if (quantitaInputs.length > 0) {
        const quantita = {};
        quantitaInputs.forEach(input => {
          const prodotto = input.dataset.prodotto;
          const valore = parseInt(input.value) || 0;
          if (valore > 0) {
            quantita[prodotto] = valore;
          }
        });
        if (Object.keys(quantita).length > 0) {
          body.prodotti_quantita = JSON.stringify(quantita);
        }
      }

      // Aggiungi allegato se caricato
      if (newAttachment) {
        body.allegato = newAttachment.data;
        body.allegato_nome = newAttachment.nome;
        body.allegato_tipo = newAttachment.tipo;
      }

      try {
        await api('put', `/api/rilievi/${rilievo.id}`, body);
        notify('Rilievo aggiornato con successo', 'success');
        wrap.remove();
        renderRilievi();
      } catch (error) {
        // L'errore viene già gestito da api()
      }
    });
  }
  

  /* ---------- ESEGUI RILIEVO MODAL ---------- */
  async function openEseguiRilievoModal(rilievoId, isViewOnly = false) {
    try {
      // Carica dati rilievo + dettagli
      const res = await api('get', `/api/rilievi/${rilievoId}/dettagli`);
      if (!res.success) {
        notify(res.error || 'Errore caricamento rilievo', 'error');
        return;
      }

      const { rilievo, dettagli } = res;
      
      // Stato modal
      let currentStep = 1;
      let anagrafica = dettagli?.anagrafica || {
  nome: rilievo.nome || '',
  cognome: rilievo.cognome || '',
  indirizzo: rilievo.indirizzo || '',
  cap: rilievo.cap || '',
  citta: rilievo.citta || '',
  provincia: rilievo.provincia || '',
  codice_fiscale: rilievo.codice_fiscale || '',
  telefono: rilievo.telefono || '',
  email: rilievo.email || ''
};
      
      let finestre = dettagli?.finestre || [];
      let elementi_tecnici = dettagli?.elementi_tecnici || {
        aletta_ferramenta: '',
        serratura: '',
        avvolgibili_pvc_colore: '',
        avvolgibili_alluminio_colore: '',
        piatte: '',
        angolari: '',
        celini: '',
        varie: ''
      };
      let commenti = dettagli?.commenti || '';

      // Crea modal
      const overlay = document.createElement('div');
      overlay.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto p-4';
      overlay.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-y-auto">
          <div class="sticky top-0 bg-white border-b p-4 flex justify-between items-center z-10">
            <h3 class="text-xl font-bold">
              ${isViewOnly ? '<i class="fas fa-eye mr-2"></i>Visualizza' : '<i class="fas fa-clipboard-check mr-2"></i>Esegui'} Rilievo - ${rilievo.cliente}
            </h3>
            <button class="text-gray-500 hover:text-gray-700" id="closeModalRilievo">
              <i class="fas fa-times text-xl"></i>
            </button>
          </div>

          <!-- Step Indicator -->
          <div class="flex justify-between items-center p-4 bg-gray-50 border-b">
            <div class="flex-1 text-center">
              <div class="step-indicator" data-step="1">
                <div class="inline-block w-10 h-10 rounded-full border-2 flex items-center justify-center font-bold">1</div>
                <div class="text-sm mt-1">Anagrafica</div>
              </div>
            </div>
            <div class="flex-1 text-center">
              <div class="step-indicator" data-step="2">
                <div class="inline-block w-10 h-10 rounded-full border-2 flex items-center justify-center font-bold">2</div>
                <div class="text-sm mt-1">Finestre</div>
              </div>
            </div>
            <div class="flex-1 text-center">
              <div class="step-indicator" data-step="3">
                <div class="inline-block w-10 h-10 rounded-full border-2 flex items-center justify-center font-bold">3</div>
                <div class="text-sm mt-1">Elementi Tecnici</div>
              </div>
            </div>
            <div class="flex-1 text-center">
              <div class="step-indicator" data-step="4">
                <div class="inline-block w-10 h-10 rounded-full border-2 flex items-center justify-center font-bold">4</div>
                <div class="text-sm mt-1">Commenti</div>
              </div>
            </div>
          </div>

          <!-- Step Content -->
          <div id="stepContent" class="p-6"></div>

          <!-- Navigation Buttons -->
          <div class="sticky bottom-0 bg-white border-t p-4 flex justify-between">
            <button id="btnPrevStep" class="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400" style="display:none">
              <i class="fas fa-arrow-left mr-2"></i>Indietro
            </button>
            <div class="flex-1"></div>
            <button id="btnNextStep" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
              Avanti<i class="fas fa-arrow-right ml-2"></i>
            </button>
            <button id="btnSaveRilievo" class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600" style="display:none">
              <i class="fas fa-save mr-2"></i>Salva Rilievo
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Helper: Update step indicator
      function updateStepIndicator() {
        $$('.step-indicator', overlay).forEach((el, idx) => {
          const stepNum = idx + 1;
          const circle = el.querySelector('div');
          if (stepNum === currentStep) {
            circle.className = 'inline-block w-10 h-10 rounded-full border-2 border-blue-500 bg-blue-500 text-white flex items-center justify-center font-bold';
          } else if (stepNum < currentStep) {
            circle.className = 'inline-block w-10 h-10 rounded-full border-2 border-green-500 bg-green-500 text-white flex items-center justify-center font-bold';
          } else {
            circle.className = 'inline-block w-10 h-10 rounded-full border-2 border-gray-300 text-gray-600 flex items-center justify-center font-bold';
          }
        });
      }

      // Render Step 1: Anagrafica
      function renderStep1() {
        $('#stepContent', overlay).innerHTML = `
          <h4 class="text-lg font-bold mb-4">Dati Cliente</h4>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium mb-1">Nome *</label>
              <input type="text" name="nome" value="${anagrafica.nome}" class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Cognome *</label>
              <input type="text" name="cognome" value="${anagrafica.cognome}" class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Indirizzo</label>
              <input type="text" name="indirizzo" value="${anagrafica.indirizzo}" class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">CAP</label>
              <input type="text" name="cap" value="${anagrafica.cap}" class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Città</label>
              <input type="text" name="citta" value="${anagrafica.citta}" class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Provincia</label>
              <input type="text" name="provincia" value="${anagrafica.provincia}" class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Codice Fiscale</label>
              <input type="text" name="codice_fiscale" value="${anagrafica.codice_fiscale}" class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Telefono *</label>
              <input type="text" name="telefono" value="${anagrafica.telefono}" class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Email</label>
              <input type="email" name="email" value="${anagrafica.email}" class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
          </div>
        `;
      }

      // Render Step 2: Finestre
      function renderStep2() {
        $('#stepContent', overlay).innerHTML = `
          <h4 class="text-lg font-bold mb-4">Finestre / Porte</h4>
          <div id="finestreList"></div>
          ${!isViewOnly ? `<button id="btnAddFinestra" class="mt-4 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">
            <i class="fas fa-plus mr-2"></i>Aggiungi Finestra
          </button>` : ''}
        `;
        renderFinestreList();
      }

      function renderFinestreList() {
        const container = $('#finestreList', overlay);
        if (!container) return;

        if (finestre.length === 0) {
          container.innerHTML = '<p class="text-gray-500 italic">Nessuna finestra aggiunta</p>';
          return;
        }

        container.innerHTML = finestre.map((f, idx) => `
          <div class="border rounded p-4 mb-6 bg-gray-50">
            <div class="flex justify-between items-start mb-3">
              <h5 class="font-bold text-lg">Finestra ${idx + 1}</h5>
              ${!isViewOnly ? `<button class="text-red-500 hover:text-red-700" data-remove-finestra="${idx}">
                <i class="fas fa-trash"></i>
              </button>` : ''}
            </div>
            
            <div class="grid md:grid-cols-2 gap-6">
              <!-- Form Finestra -->
              <div class="space-y-3">
                <div>
                  <label class="block text-sm font-medium mb-1">Tipo *</label>
                  <select name="tipo_${idx}" class="w-full p-2 border rounded finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                    <option value="finestra" ${f.tipo === 'finestra' ? 'selected' : ''}>Finestra</option>
                    <option value="porta-finestra" ${f.tipo === 'porta-finestra' ? 'selected' : ''}>Porta-finestra</option>
                    <option value="porta" ${f.tipo === 'porta' ? 'selected' : ''}>Porta</option>
                    <option value="portoncino" ${f.tipo === 'portoncino' ? 'selected' : ''}>Portoncino</option>
                  </select>

                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Numero Ante *</label>
                  <select name="numero_ante_${idx}" class="w-full p-2 border rounded finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                    <option value="1" ${f.numero_ante == 1 ? 'selected' : ''}>1 Anta</option>
                    <option value="2" ${f.numero_ante == 2 ? 'selected' : ''}>2 Ante</option>
                    <option value="3" ${f.numero_ante == 3 ? 'selected' : ''}>3 Ante</option>
                    <option value="4" ${f.numero_ante == 4 ? 'selected' : ''}>4 Ante</option>
                  </select>
                </div>
                 <div>
                  <label class="block text-sm font-medium mb-1">Tipo Apertura *</label>
                  <select name="tipo_apertura_${idx}" class="w-full p-2 border rounded finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                    <option value="">-- Seleziona --</option>
                    <option value="Battente DX" ${f.tipo_apertura === 'Battente DX' ? 'selected' : ''}>Battente DX</option>
                    <option value="Battente SX" ${f.tipo_apertura === 'Battente SX' ? 'selected' : ''}>Battente SX</option>
                    <option value="Scorrevole" ${f.tipo_apertura === 'Scorrevole' ? 'selected' : ''}>Scorrevole</option>
                    <option value="Vasistas" ${f.tipo_apertura === 'Vasistas' ? 'selected' : ''}>Vasistas</option>
                    <option value="Fisso" ${f.tipo_apertura === 'Fisso' ? 'selected' : ''}>Fisso</option>
                    <option value="Bilico" ${f.tipo_apertura === 'Bilico' ? 'selected' : ''}>Bilico</option>
                  </select>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-sm font-medium mb-1">Altezza (cm) *</label>
                    <input type="number" name="altezza_${idx}" value="${f.altezza || ''}" 
                      class="w-full p-2 border rounded finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                  </div>
                  <div>
                    <label class="block text-sm font-medium mb-1">Larghezza (cm) *</label>
                    <input type="number" name="larghezza_${idx}" value="${f.larghezza || ''}" 
                      class="w-full p-2 border rounded finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-sm font-medium mb-1">Tapparella</label>
                    <select name="tapparella_${idx}" class="w-full p-2 border rounded finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                      <option value="no" ${f.tapparella === 'no' ? 'selected' : ''}>No</option>
                      <option value="si" ${f.tapparella === 'si' ? 'selected' : ''}>Sì</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-sm font-medium mb-1">Cassonetto</label>
                    <select name="cassonetto_${idx}" class="w-full p-2 border rounded finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                      <option value="no" ${f.cassonetto === 'no' ? 'selected' : ''}>No</option>
                      <option value="si" ${f.cassonetto === 'si' ? 'selected' : ''}>Sì</option>
                     </select>
                  </div>
                </div>
                
                <!-- Dettagli Tapparella -->
                ${f.tapparella === 'si' ? `
                  <div class="p-3 bg-blue-50 rounded border-l-4 border-blue-500">
                    <h5 class="text-sm font-semibold mb-2 text-blue-700">Dettagli Tapparella</h5>
                    <div class="grid grid-cols-3 gap-2">
                      <div>
                        <label class="block text-xs text-gray-600 mb-1">Altezza (cm)</label>
                        <input type="number" name="tapparella_altezza_${idx}" value="${f.tapparella_altezza || ''}" 
                          class="w-full p-2 border rounded text-sm finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                      </div>
                      <div>
                        <label class="block text-xs text-gray-600 mb-1">Larghezza (cm)</label>
                        <input type="number" name="tapparella_larghezza_${idx}" value="${f.tapparella_larghezza || ''}" 
                          class="w-full p-2 border rounded text-sm finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                      </div>
                      <div>
                        <label class="block text-xs text-gray-600 mb-1">Colore</label>
                        <input type="text" name="tapparella_colore_${idx}" value="${f.tapparella_colore || ''}" 
                          placeholder="es: Bianco, Marrone" 
                          class="w-full p-2 border rounded text-sm finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                      </div>
                    </div>
                  </div>
                ` : ''}
                
                <!-- Dettagli Cassonetto -->
                ${f.cassonetto === 'si' ? `
                  <div class="p-3 bg-purple-50 rounded border-l-4 border-purple-500">
                    <h5 class="text-sm font-semibold mb-2 text-purple-700">Misure Cassonetto</h5>
                    <div class="grid grid-cols-3 gap-2">
                      <div>
                        <label class="block text-xs text-gray-600 mb-1">Altezza (cm)</label>
                        <input type="number" name="cassonetto_altezza_${idx}" value="${f.cassonetto_altezza || ''}" 
                          class="w-full p-2 border rounded text-sm finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                      </div>
                      <div>
                        <label class="block text-xs text-gray-600 mb-1">Larghezza (cm)</label>
                        <input type="number" name="cassonetto_larghezza_${idx}" value="${f.cassonetto_larghezza || ''}" 
                          class="w-full p-2 border rounded text-sm finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                      </div>
                      <div>
                        <label class="block text-xs text-gray-600 mb-1">Profondità (cm)</label>
                        <input type="number" name="cassonetto_profondita_${idx}" value="${f.cassonetto_profondita || ''}" 
                          class="w-full p-2 border rounded text-sm finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                      </div>
                    </div>
                    <div class="mt-2">
                      <label class="block text-xs text-gray-600 mb-1">Colore Cassonetto</label>
                      <input type="text" name="cassonetto_colore_${idx}" value="${f.cassonetto_colore || ''}" 
                        placeholder="es: Bianco, Marrone" 
                        class="w-full p-2 border rounded text-sm finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                    </div>
                  </div>
                ` : ''}
                <div>
                  <label class="block text-sm font-medium mb-1">Zanzariera</label>
                  <input type="text" name="zanzariera_${idx}" value="${f.zanzariera || ''}" 
                    placeholder="es: Plissettata bianca" class="w-full p-2 border rounded finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Tipo Vetro</label>
                  <select name="tipo_vetro_${idx}" class="w-full p-2 border rounded finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                    <option value="">-- Seleziona --</option>
                    <option value="Doppio vetro" ${f.tipo_vetro === 'Doppio vetro' ? 'selected' : ''}>Doppio vetro</option>
                    <option value="Triplo vetro" ${f.tipo_vetro === 'Triplo vetro' ? 'selected' : ''}>Triplo vetro</option>
                    <option value="Vetro sabbiato" ${f.tipo_vetro === 'Vetro sabbiato' ? 'selected' : ''}>Vetro sabbiato</option>
                    <option value="Vetro satinato" ${f.tipo_vetro === 'Vetro satinato' ? 'selected' : ''}>Vetro satinato</option>
                    <option value="Vetro temperato" ${f.tipo_vetro === 'Vetro temperato' ? 'selected' : ''}>Vetro temperato</option>
                    <option value="Vetro basso emissivo" ${f.tipo_vetro === 'Vetro basso emissivo' ? 'selected' : ''}>Vetro basso emissivo</option>
                  </select>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-sm font-medium mb-1">Colore Interno</label>
                    <input type="text" name="colore_interno_${idx}" value="${f.colore_interno || ''}" 
                      class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
                  </div>
                  <div>
                    <label class="block text-sm font-medium mb-1">Colore Esterno</label>
                    <input type="text" name="colore_esterno_${idx}" value="${f.colore_esterno || ''}" 
                      class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
                  </div>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <div>
                    <label class="block text-sm font-medium mb-1">Marca Infisso</label>
                    <input type="text" name="marca_${idx}" value="${f.marca || ''}" 
                      class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
                  </div>
                  <div>
                    <label class="block text-sm font-medium mb-1">Modello Infisso</label>
                    <input type="text" name="modello_${idx}" value="${f.modello || ''}" 
                      class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
                  </div>
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Stanza/Posizione</label>
                  <input type="text" name="stanza_${idx}" value="${f.stanza || ''}" 
                    placeholder="es: Cucina, Camera matrimoniale" class="w-full p-2 border rounded finestra-input" data-idx="${idx}" ${isViewOnly ? 'disabled' : ''}>
                </div>
              </div>
              
              <!-- Schizzo SVG -->
              <div class="flex items-center justify-center bg-white rounded border p-4">
                <div id="schizzo_${idx}">
                  ${f.altezza && f.larghezza ? generateFinestraSVG(f) : '<p class="text-gray-400 italic">Compila tipo, ante, misure per vedere lo schizzo</p>'}
                </div>
              </div>
            </div>
          </div>
        `).join('');

        // Event listener per rimozione
        if (!isViewOnly) {
          $$('[data-remove-finestra]', container).forEach(btn => {
            btn.addEventListener('click', () => {
              const idx = parseInt(btn.dataset.removeFinestra);
              finestre.splice(idx, 1);
              renderFinestreList();
            });
          });
          
		  // Event listener per tapparella/cassonetto change -> ricarica vista

          $$('[name^="tapparella_"]', container).forEach(select => {
            select.addEventListener('change', () => {
              collectCurrentStepData();
              renderFinestreList();
            });
          });

          
          $$('[name^="cassonetto_"]', container).forEach(select => {
            select.addEventListener('change', () => {
              collectCurrentStepData();
              renderFinestreList();
            });
          });
		  
          // Event listener per aggiornamento schizzo in tempo reale
          $$('.finestra-input', container).forEach(input => {
            input.addEventListener('input', (e) => {
              const idx = parseInt(e.target.dataset.idx);
              if (idx !== undefined) {
                // Aggiorna dati finestra
                const tipo = $(`[name="tipo_${idx}"]`, container).value;
                const numero_ante = $(`[name="numero_ante_${idx}"]`, container).value;
                const tipo_apertura = $(`[name="tipo_apertura_${idx}"]`, container).value;
                const altezza = $(`[name="altezza_${idx}"]`, container).value;
                const larghezza = $(`[name="larghezza_${idx}"]`, container).value;
                const tapparella = $(`[name="tapparella_${idx}"]`, container).value;
                const cassonetto = $(`[name="cassonetto_${idx}"]`, container).value;
                const zanzariera = $(`[name="zanzariera_${idx}"]`, container).value;
                const stanza = $(`[name="stanza_${idx}"]`, container).value;
                
                if (altezza && larghezza) {
                  const schizzoContainer = $(`#schizzo_${idx}`, container);
                  if (schizzoContainer) {
                    schizzoContainer.innerHTML = generateFinestraSVG({
                      tipo, numero_ante, tipo_apertura, altezza, larghezza,
                      tapparella, cassonetto, zanzariera, stanza
                    });
                  }
                }
              }
            });
          });
        }
      }

      // Render Step 3: Elementi Tecnici
      function renderStep3() {
        $('#stepContent', overlay).innerHTML = `
          <h4 class="text-lg font-bold mb-4">Elementi Tecnici Generali</h4>
          <div class="grid md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium mb-1">Aletta / Ferramenta</label>
              <input type="text" name="aletta_ferramenta" value="${elementi_tecnici.aletta_ferramenta}" 
                class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Serratura</label>
              <input type="text" name="serratura" value="${elementi_tecnici.serratura}" 
                class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Avvolgibili PVC Colore</label>
              <input type="text" name="avvolgibili_pvc_colore" value="${elementi_tecnici.avvolgibili_pvc_colore}" 
                class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Avvolgibili Alluminio Colore</label>
              <input type="text" name="avvolgibili_alluminio_colore" value="${elementi_tecnici.avvolgibili_alluminio_colore}" 
                class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Piatte</label>
              <input type="text" name="piatte" value="${elementi_tecnici.piatte}" 
                class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Angolari</label>
              <input type="text" name="angolari" value="${elementi_tecnici.angolari}" 
                class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Celini</label>
              <input type="text" name="celini" value="${elementi_tecnici.celini}" 
                class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Varie</label>
              <input type="text" name="varie" value="${elementi_tecnici.varie}" 
                class="w-full p-2 border rounded" ${isViewOnly ? 'disabled' : ''}>
            </div>
          </div>
        `;
      }

      // Render Step 4: Commenti
      function renderStep4() {
        $('#stepContent', overlay).innerHTML = `
          <h4 class="text-lg font-bold mb-4">Commenti / Note Finali</h4>
          <p class="text-sm text-gray-600 mb-2">
            Inserisci qui tutte le informazioni aggiuntive: stato dei muri, problematiche, piatte, indicazioni particolari, ecc.
          </p>
          <textarea name="commenti" rows="10" class="w-full p-3 border rounded" 
            placeholder="Es: Muri in buono stato, necessaria rimozione vecchi infissi, cliente richiede installazione rapida..." 
            ${isViewOnly ? 'disabled' : ''}>${commenti}</textarea>
        `;
      }

      // Render current step
      function renderCurrentStep() {
        if (currentStep === 1) renderStep1();
        else if (currentStep === 2) renderStep2();
        else if (currentStep === 3) renderStep3();
        else if (currentStep === 4) renderStep4();

        updateStepIndicator();
        updateNavigationButtons();
      }

      // Update navigation buttons
      function updateNavigationButtons() {
        const btnPrev = $('#btnPrevStep', overlay);
        const btnNext = $('#btnNextStep', overlay);
        const btnSave = $('#btnSaveRilievo', overlay);

        if (isViewOnly) {
          btnPrev.style.display = currentStep > 1 ? 'block' : 'none';
          btnNext.style.display = currentStep < 4 ? 'block' : 'none';
          btnSave.style.display = 'none';
        } else {
          btnPrev.style.display = currentStep > 1 ? 'block' : 'none';
          btnNext.style.display = currentStep < 4 ? 'block' : 'none';
          btnSave.style.display = currentStep === 4 ? 'block' : 'none';
        }
      }

      // Collect data from current step
      function collectCurrentStepData() {
        const content = $('#stepContent', overlay);
        
        if (currentStep === 1) {
          // Anagrafica
          anagrafica = {
            nome: $('[name="nome"]', content).value,
            cognome: $('[name="cognome"]', content).value,
            indirizzo: $('[name="indirizzo"]', content).value,
            cap: $('[name="cap"]', content).value,
            citta: $('[name="citta"]', content).value,
            provincia: $('[name="provincia"]', content).value,
            codice_fiscale: $('[name="codice_fiscale"]', content).value,
            telefono: $('[name="telefono"]', content).value,
            email: $('[name="email"]', content).value
          };
        } else if (currentStep === 2) {
          // Finestre
          finestre = finestre.map((f, idx) => ({
            tipo: $(`[name="tipo_${idx}"]`, content)?.value || f.tipo,
            numero_ante: $(`[name="numero_ante_${idx}"]`, content)?.value || f.numero_ante,
            tipo_apertura: $(`[name="tipo_apertura_${idx}"]`, content)?.value || f.tipo_apertura,
            altezza: $(`[name="altezza_${idx}"]`, content)?.value || f.altezza,
            larghezza: $(`[name="larghezza_${idx}"]`, content)?.value || f.larghezza,
            tapparella: $(`[name="tapparella_${idx}"]`, content)?.value || f.tapparella,
            cassonetto: $(`[name="cassonetto_${idx}"]`, content)?.value || f.cassonetto,
            cassonetto_altezza: $(`[name="cassonetto_altezza_${idx}"]`, content)?.value || f.cassonetto_altezza,
            cassonetto_larghezza: $(`[name="cassonetto_larghezza_${idx}"]`, content)?.value || f.cassonetto_larghezza,
 cassonetto_profondita: $(`[name="cassonetto_profondita_${idx}"]`, content)?.value || f.cassonetto_profondita,
            cassonetto_colore: $(`[name="cassonetto_colore_${idx}"]`, content)?.value || f.cassonetto_colore,
            tapparella_altezza: $(`[name="tapparella_altezza_${idx}"]`, content)?.value || f.tapparella_altezza,
            tapparella_larghezza: $(`[name="tapparella_larghezza_${idx}"]`, content)?.value || f.tapparella_larghezza,
            tapparella_colore: $(`[name="tapparella_colore_${idx}"]`, content)?.value || f.tapparella_colore,
            zanzariera: $(`[name="zanzariera_${idx}"]`, content)?.value || f.zanzariera,
            tipo_vetro: $(`[name="tipo_vetro_${idx}"]`, content)?.value || f.tipo_vetro,
            colore_interno: $(`[name="colore_interno_${idx}"]`, content)?.value || f.colore_interno,
            colore_esterno: $(`[name="colore_esterno_${idx}"]`, content)?.value || f.colore_esterno,
            marca: $(`[name="marca_${idx}"]`, content)?.value || f.marca,
            modello: $(`[name="modello_${idx}"]`, content)?.value || f.modello,
            stanza: $(`[name="stanza_${idx}"]`, content)?.value || f.stanza
          }));
        } else if (currentStep === 3) {
          // Elementi tecnici
          elementi_tecnici = {
            aletta_ferramenta: $('[name="aletta_ferramenta"]', content).value,
            serratura: $('[name="serratura"]', content).value,
            avvolgibili_pvc_colore: $('[name="avvolgibili_pvc_colore"]', content).value,
            avvolgibili_alluminio_colore: $('[name="avvolgibili_alluminio_colore"]', content).value,
            piatte: $('[name="piatte"]', content).value,
            angolari: $('[name="angolari"]', content).value,
            celini: $('[name="celini"]', content).value,
            varie: $('[name="varie"]', content).value
          };
        } else if (currentStep === 4) {
          // Commenti
          commenti = $('[name="commenti"]', content).value;
        }
      }

      // Navigation: Previous
      $('#btnPrevStep', overlay).addEventListener('click', () => {
        collectCurrentStepData();
        currentStep--;
        renderCurrentStep();
      });

      // Navigation: Next
      $('#btnNextStep', overlay).addEventListener('click', () => {
        // Validate current step
        if (currentStep === 1) {
          if (!anagrafica.nome || !anagrafica.cognome || !anagrafica.telefono) {
            notify('Compila i campi obbligatori: Nome, Cognome, Telefono', 'error');
            return;
          }
        }

        collectCurrentStepData();
        currentStep++;
        renderCurrentStep();
      });

      // Add finestra button
      $('#stepContent', overlay).addEventListener('click', (e) => {
        if (e.target.closest('#btnAddFinestra')) {
          collectCurrentStepData();
        finestre.push({
            tipo: 'finestra',
            numero_ante: 1,
            tipo_apertura: '',
            altezza: '',
            larghezza: '',
            tapparella: 'no',
            cassonetto: 'no',
            cassonetto_altezza: '',
            cassonetto_larghezza: '',
            cassonetto_profondita: '',
            cassonetto_colore: '',
            tapparella_altezza: '',
            tapparella_larghezza: '',
            tapparella_colore: '',
            zanzariera: '',
            tipo_vetro: '',
            colore_interno: '',
            colore_esterno: '',
            marca: '',
            modello: '',
            stanza: ''
          });
          renderFinestreList();
        }
      });

      // Save rilievo
      $('#btnSaveRilievo', overlay).addEventListener('click', async () => {
        collectCurrentStepData();

        // Validation
        if (!anagrafica.nome || !anagrafica.cognome || !anagrafica.telefono) {
          notify('Compila i campi obbligatori anagrafica', 'error');
          return;
        }

        const saveData = {
          anagrafica,
          finestre,
          elementi_tecnici,
          commenti
        };

        const res = await api('post', `/api/rilievi/${rilievoId}/dettagli`, saveData);
        if (res.success) {
          notify('Rilievo salvato con successo!', 'success');
          document.body.removeChild(overlay);
          await loadRilievi();
        } else {
          notify(res.error || 'Errore salvataggio rilievo', 'error');
        }
      });

      // Close modal
      $('#closeModalRilievo', overlay).addEventListener('click', () => {
        document.body.removeChild(overlay);
      });

      // Initial render
      renderCurrentStep();

    } catch (err) {
      console.error('Errore apertura modal rilievo:', err);
      notify('Errore caricamento rilievo', 'error');
    }
  }
  
   /* ==================== PRATICHE ENEA ==================== */
  async function renderPraticheEnea() {
    if (state.user?.role !== 'admin') {
      $('#main').innerHTML = '<div class="text-center text-red-600 p-8">Accesso negato</div>';
      return;
    }

    $('#main').innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-semibold">
          <i class="fas fa-file-invoice mr-2 text-green-600"></i>Pratiche ENEA
        </h2>
        <button id="btnViewArchiviate" class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600">
          <i class="fas fa-archive mr-1"></i>Archiviate
        </button>
      </div>

      <div class="grid gap-6">
        <div class="bg-white rounded-lg shadow p-6">
          <h3 class="text-lg font-semibold mb-4 text-orange-600">
            <i class="fas fa-clock mr-2"></i>Da Fare
          </h3>
          <div id="praticheContainer" class="space-y-3"></div>
        </div>

        <div class="bg-white rounded-lg shadow p-6">
          <h3 class="text-lg font-semibold mb-4 text-green-600">
            <i class="fas fa-check-circle mr-2"></i>Completate
          </h3>
          <div id="completateContainer" class="space-y-3"></div>
        </div>
      </div>
    `;

    async function loadPratiche() {
      try {
        const { pratiche } = await api('get', '/api/pratiche-enea');
        const daFare = pratiche.filter(p => p.stato === 'da_fare');
        const completate = pratiche.filter(p => p.stato === 'completato');

        $('#praticheContainer').innerHTML = daFare.length ? daFare.map(p => `
          <div class="border rounded p-4 hover:shadow-md cursor-pointer" data-pratica-id="${p.id}">
            <div class="flex justify-between items-start mb-2">
              <div class="font-semibold">${p.nome || ''} ${p.cognome || ''}</div>
              <span class="px-2 py-1 bg-orange-100 text-orange-700 text-xs rounded">Da Fare</span>
            </div>
            <div class="text-sm text-gray-600 space-y-1">
              ${p.telefono ? `<div><i class="fas fa-phone mr-1"></i>${p.telefono}</div>` : ''}
              ${p.indirizzo ? `<div><i class="fas fa-map-marker-alt mr-1"></i>${p.indirizzo}, ${p.citta || ''}</div>` : ''}
              <div><i class="fas fa-calendar mr-1"></i>Montaggio: ${fmtDate(p.data_completamento_montaggio)}</div>
              ${p.product_type ? `<div><i class="fas fa-box mr-1"></i>${p.product_type.replace(/_/g, ' ')}</div>` : ''}
            </div>
          </div>
        `).join('') : '<p class="text-gray-500 text-center py-4">Nessuna pratica da fare</p>';

        $('#completateContainer').innerHTML = completate.length ? completate.map(p => `
          <div class="border rounded p-4 hover:shadow-md cursor-pointer" data-pratica-id="${p.id}">
            <div class="flex justify-between items-start mb-2">
              <div class="font-semibold">${p.nome || ''} ${p.cognome || ''}</div>
              <span class="px-2 py-1 bg-green-100 text-green-700 text-xs rounded">Completato</span>
            </div>
            <div class="text-sm text-gray-600 space-y-1">
              ${p.telefono ? `<div><i class="fas fa-phone mr-1"></i>${p.telefono}</div>` : ''}
              <div><i class="fas fa-calendar mr-1"></i>Montaggio: ${fmtDate(p.data_completamento_montaggio)}</div>
              ${p.data_completamento ? `<div class="text-green-600"><i class="fas fa-check mr-1"></i>Completata: ${fmtDate(p.data_completamento)}</div>` : ''}
            </div>
          </div>
        `).join('') : '<p class="text-gray-500 text-center py-4">Nessuna pratica completata</p>';


        $$('[data-pratica-id]').forEach(card => {
          card.addEventListener('click', () => {
            const pratica = pratiche.find(p => p.id == card.dataset.praticaId);
            if (pratica) openPraticaModal(pratica);
          });
        });
      } catch (e) {
        notify('Errore caricamento', 'error');
      }
    }

    function openPraticaModal(pratica) {
      const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4' });
      wrap.innerHTML = `
        <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          <div class="flex justify-between items-center p-6 border-b">
            <h3 class="text-xl font-bold">Pratica ENEA - ${pratica.nome} ${pratica.cognome}</h3>
            <button onclick="this.closest('.fixed').remove()" class="text-gray-500 hover:text-gray-700">
              <i class="fas fa-times text-xl"></i>
            </button>
          </div>
          <div class="p-6 space-y-4">
            <div class="bg-gray-50 rounded p-4">
              <h4 class="font-semibold mb-2">Anagrafica</h4>
              <div class="grid md:grid-cols-2 gap-2 text-sm">
                <div><strong>Nome:</strong> ${pratica.nome} ${pratica.cognome}</div>
                <div><strong>Telefono:</strong> ${pratica.telefono || 'N/A'}</div>
                <div><strong>Email:</strong> ${pratica.email || 'N/A'}</div>
                <div><strong>Indirizzo:</strong> ${pratica.indirizzo || 'N/A'}</div>
                <div><strong>Città:</strong> ${pratica.citta || 'N/A'} ${pratica.cap || ''}</div>
                <div><strong>Provincia:</strong> ${pratica.provincia || 'N/A'}</div>
              </div>
            </div>
            <div class="bg-blue-50 rounded p-4">
              <h4 class="font-semibold mb-2">Dati Montaggio</h4>
              <div class="text-sm space-y-1">
                <div><strong>Data:</strong> ${fmtDate(pratica.data_completamento_montaggio)}</div>
                <div><strong>Prodotto:</strong> ${pratica.product_type?.replace(/_/g, ' ') || 'N/A'}</div>
                <div><strong>Montatori:</strong> ${pratica.montatori || 'N/A'}</div>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium mb-1">Stato</label>
              <select id="statoPratica" class="w-full p-2 border rounded">
                <option value="da_fare" ${pratica.stato === 'da_fare' ? 'selected' : ''}>Da Fare</option>
                <option value="completato" ${pratica.stato === 'completato' ? 'selected' : ''}>Completato</option>
              </select>
            </div>
            ${pratica.data_completamento ? `
              <div class="bg-green-50 rounded p-3 text-sm text-green-700">
                <i class="fas fa-check-circle mr-1"></i>Completata il ${fmtDate(pratica.data_completamento)}
              </div>
            ` : ''}
            <div>
              <label class="block text-sm font-medium mb-1">Note</label>
              <textarea id="notePratica" rows="3" class="w-full p-2 border rounded">${pratica.note || ''}</textarea>
            </div>
          </div>
          <div class="flex justify-between items-center p-6 border-t bg-gray-50">
            <button id="btnArchivia" class="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700">
              <i class="fas fa-archive mr-1"></i>Archivia
            </button>
            <div class="flex gap-2">
              <button onclick="this.closest('.fixed').remove()" class="px-4 py-2 border rounded">Annulla</button>
              <button id="btnSalvaPratica" class="px-4 py-2 bg-blue-500 text-white rounded">
                <i class="fas fa-save mr-1"></i>Salva
              </button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(wrap);

      $('#btnSalvaPratica', wrap).addEventListener('click', async () => {
        try {
          await api('put', `/api/pratiche-enea/${pratica.id}`, {
            stato: $('#statoPratica', wrap).value,
            note: $('#notePratica', wrap).value
          });
          notify('Aggiornata', 'success');
          wrap.remove();
          loadPratiche();
        } catch (e) {
          notify('Errore', 'error');
        }
      });

      $('#btnArchivia', wrap).addEventListener('click', async () => {
        if (!confirm('Archiviare?')) return;
        try {
          await api('put', `/api/pratiche-enea/${pratica.id}`, { archiviato: 1 });
          notify('Archiviata', 'success');
          wrap.remove();
          loadPratiche();
        } catch (e) {}
      });
    }

    $('#btnViewArchiviate').addEventListener('click', async () => {
      try {
        const { pratiche } = await api('get', '/api/pratiche-enea/archiviate');
        const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4' });
        wrap.innerHTML = `
          <div class="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center p-6 border-b">
              <h3 class="text-xl font-bold">Archiviate</h3>
              <button onclick="this.closest('.fixed').remove()" class="text-gray-500">
                <i class="fas fa-times text-xl"></i>
              </button>
            </div>
            <div class="p-6">
              <table class="min-w-full">
                <thead>
                  <tr class="border-b">
                    <th class="px-4 py-2 text-left">Cliente</th>
                    <th class="px-4 py-2 text-left">Telefono</th>
                    <th class="px-4 py-2 text-left">Prodotto</th>
                    <th class="px-4 py-2 text-left">Montaggio</th>
                    <th class="px-4 py-2 text-left">Completamento</th>
                  </tr>
                </thead>
                <tbody>
                  ${pratiche.map(p => `
                    <tr class="border-b hover:bg-gray-50">
                      <td class="px-4 py-2">${p.nome} ${p.cognome}</td>
                      <td class="px-4 py-2">${p.telefono || 'N/A'}</td>
                      <td class="px-4 py-2">${p.product_type?.replace(/_/g, ' ') || 'N/A'}</td>
                      <td class="px-4 py-2">${fmtDate(p.data_completamento_montaggio)}</td>
                      <td class="px-4 py-2">${fmtDate(p.data_completamento)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `;
        document.body.appendChild(wrap);
      } catch (e) {}
    });

    loadPratiche();
  }

  
  /* ---------- Reports Economici ---------- */
  async function renderReports() {
    const main = $('#main');
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    
    main.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-semibold">Report Economici</h2>
        <div class="flex gap-2">
          <select id="monthSelect" class="p-2 border rounded">
            ${[...Array(12)].map((_, i) => {
              const month = i + 1;
              const monthName = new Date(2024, i, 1).toLocaleDateString('it-IT', { month: 'long' });
              return `<option value="${month}" ${month === currentMonth ? 'selected' : ''}>${monthName}</option>`;
            }).join('')}
          </select>
          <select id="yearSelect" class="p-2 border rounded">
            ${[2023, 2024, 2025].map(y => `<option value="${y}" ${y === currentYear ? 'selected' : ''}>${y}</option>`).join('')}
          </select>
          <button id="loadReport" class="px-3 py-2 bg-blue-500 text-white rounded mr-2">
            <i class="fas fa-sync mr-1"></i>Carica Report
          </button>
          <button id="downloadReport" class="px-3 py-2 bg-green-500 text-white rounded">
            <i class="fas fa-download mr-1"></i>Scarica CSV
          </button>
        </div>
      </div>
      
      <div class="grid md:grid-cols-3 gap-4 mb-6">
        <div class="bg-white rounded-lg shadow p-6">
          <div class="text-gray-500 text-sm mb-1">Entrate del mese</div>
          <div id="monthRevenue" class="text-3xl font-bold text-green-600">€ 0</div>
        </div>
        <div class="bg-white rounded-lg shadow p-6">
          <div class="text-gray-500 text-sm mb-1">Uscite del mese</div>
          <div id="monthCosts" class="text-3xl font-bold text-red-600">€ 0</div>
        </div>
        <div class="bg-white rounded-lg shadow p-6">
          <div class="text-gray-500 text-sm mb-1">Margine</div>
          <div id="monthMargin" class="text-3xl font-bold">€ 0</div>
        </div>
      </div>
      
	  <!-- 🆕 Statistiche Contatti del Mese -->
      <div class="bg-white rounded-lg shadow p-6 mb-6">
        <h3 class="text-lg font-semibold mb-4">
          <i class="fas fa-users mr-2 text-blue-600"></i>
          Statistiche Contatti del Mese
        </h3>
        <div class="grid md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div class="text-center p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div class="text-3xl font-bold text-gray-700" id="stat_totale">0</div>
            <div class="text-xs text-gray-600 mt-2">Totale Contatti</div>
          </div>
          <div class="text-center p-4 bg-purple-50 rounded-lg border border-purple-200">
            <div class="text-3xl font-bold text-purple-600" id="stat_preventivo">0</div>
            <div class="text-xs text-gray-600 mt-2">Solo Preventivo</div>
          </div>
          <div class="text-center p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div class="text-3xl font-bold text-blue-600" id="stat_interno">0</div>
            <div class="text-xs text-gray-600 mt-2">App. Interno</div>
          </div>
          <div class="text-center p-4 bg-cyan-50 rounded-lg border border-cyan-200">
            <div class="text-3xl font-bold text-cyan-600" id="stat_venditore">0</div>
            <div class="text-xs text-gray-600 mt-2">App. Venditore</div>
          </div>
          <div class="text-center p-4 bg-green-50 rounded-lg border border-green-200">
            <div class="text-3xl font-bold text-green-600" id="stat_firmato">0</div>
            <div class="text-xs text-gray-600 mt-2">Contratto Firmato</div>
          </div>
          <div class="text-center p-4 bg-emerald-50 rounded-lg border border-emerald-200">
            <div class="text-3xl font-bold text-emerald-600" id="stat_firmato_ufficio">0</div>
            <div class="text-xs text-gray-600 mt-2">Firmato Ufficio</div>
          </div>
        </div>
      </div>
      <div class="bg-white rounded-lg shadow p-6 mb-6">
        <h3 class="text-lg font-semibold mb-4">Dettaglio Vendite</h3>
        <div class="overflow-x-auto">
          <table class="min-w-full">
            <thead>
              <tr>
                <th class="px-4 py-2 text-left">Data</th>
                <th class="px-4 py-2 text-left">Cliente</th>
                <th class="px-4 py-2 text-left">N° Ordine</th>
                <th class="px-4 py-2 text-left">Venditore</th>
                <th class="px-4 py-2 text-right">Importo</th>
                <th class="px-4 py-2 text-center">Azioni</th>
              </tr>
            </thead>
            <tbody id="salesDetail"></tbody>
          </table>
        </div>
      </div>
      
      <div class="bg-white rounded-lg shadow p-6">
        <h3 class="text-lg font-semibold mb-4">Dettaglio Costi (Ordini)</h3>
		
        <div class="overflow-x-auto">
          <table class="min-w-full">
            <thead>
              <tr>
                <th class="px-4 py-2 text-left">Cliente</th>
                <th class="px-4 py-2 text-left">Prodotto</th>
                <th class="px-4 py-2 text-left">Data Prevista</th>
                <th class="px-4 py-2 text-left">Data Arrivo</th>
                <th class="px-4 py-2 text-right">Costo</th>
              </tr>
            </thead>
            <tbody id="costsDetail"></tbody>
          </table>
        </div>
      </div>
      
      <div class="bg-white rounded-lg shadow p-6 mt-6">
        <h3 class="text-lg font-semibold mb-4">Grafico Andamento Annuale</h3>
        <canvas id="yearChart" height="80"></canvas>
      </div>
    `;
    
    const loadReportData = async () => {
      const month = $('#monthSelect').value;
      const year = $('#yearSelect').value;
      try {
        const { report } = await api('get', `/api/reports/monthly?month=${month}&year=${year}`);
        $('#monthRevenue').textContent = euro(report.revenue || 0);
        $('#monthCosts').textContent = euro(report.costs || 0);
        const margin = (report.revenue || 0) - (report.costs || 0);
        $('#monthMargin').textContent = euro(margin);
        $('#monthMargin').className = `text-3xl font-bold ${margin >= 0 ? 'text-green-600' : 'text-red-600'}`;
        // 🆕 Popola statistiche contatti
        if (report.contactStats) {
          $('#stat_totale').textContent = report.contactStats.totale_contatti || 0;
          $('#stat_preventivo').textContent = report.contactStats.solo_preventivo || 0;
          $('#stat_interno').textContent = report.contactStats.appuntamento_interno || 0;
          $('#stat_venditore').textContent = report.contactStats.appuntamento_venditore || 0;
          $('#stat_firmato').textContent = report.contactStats.contratto_firmato || 0;
          $('#stat_firmato_ufficio').textContent = report.contactStats.contratto_firmato_ufficio || 0;
        }
        $('#salesDetail').innerHTML = (report.sales || []).map(s => `
          <tr class="hover:bg-gray-50 border-b">
            <td class="px-4 py-2">${fmtDate(s.data_vendita)}</td>
            <td class="px-4 py-2">${s.cliente}</td>
            <td class="px-4 py-2">${s.numero_ordine}</td>
            <td class="px-4 py-2">${s.venditore}</td>
            <td class="px-4 py-2 text-right font-semibold">${euro(s.totale)}</td>
            <td class="px-4 py-2 text-center">
              <button class="px-2 py-1 text-blue-600 hover:bg-blue-50 rounded" 
                      data-edit-report="${s.id}" title="Modifica">
                <i class="fas fa-edit"></i>
              </button>
            </td>
          </tr>
        `).join('') || '<tr><td colspan="6" class="px-4 py-2 text-center text-gray-500">Nessuna vendita</td></tr>';
        
        // 🆕 Handler per modificare vendita dal report

        $$('button[data-edit-report]').forEach(b => b.addEventListener('click', async () => {
          const saleId = b.dataset.editReport;
          const sale = report.sales.find(s => s.id == saleId);
          if (sale) {
            await openEditSaleModal(sale);
            // Ricarica il report dopo la modifica
            await loadReportData();
          }
        }));
        
        $('#costsDetail').innerHTML = (report.orderItems || []).map(i => `
          <tr class="hover:bg-gray-50 border-b">
            <td class="px-4 py-2">${i.cliente}</td>
            <td class="px-4 py-2">${i.product_type.replace('_', ' ')}</td>
            <td class="px-4 py-2">${fmtDate(i.data_prevista)}</td>
            <td class="px-4 py-2">${fmtDate(i.data_arrivo)}</td>
            <td class="px-4 py-2 text-right font-semibold">${euro(i.costo)}</td>
          </tr>
        `).join('') || '<tr><td colspan="5" class="px-4 py-2 text-center text-gray-500">Nessun costo</td></tr>';
        
        const ctx = $('#yearChart').getContext('2d');
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: report.yearData?.map(d => d.month) || [],
            datasets: [
              { label: 'Entrate', data: report.yearData?.map(d => d.revenue) || [], borderColor: 'rgb(16,185,129)', backgroundColor: 'rgba(16,185,129,0.1)', tension: 0.3 },
              { label: 'Uscite',  data: report.yearData?.map(d => d.costs)   || [], borderColor: 'rgb(239,68,68)',  backgroundColor: 'rgba(239,68,68,0.1)',  tension: 0.3 },
              { label: 'Margine', data: report.yearData?.map(d => d.revenue - d.costs) || [], borderColor: 'rgb(59,130,246)', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.3 }
            ]
          },
          options: {
            responsive: true,
            plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${euro(c.parsed.y)}` } } },
            scales: { y: { beginAtZero: true, ticks: { callback: (v) => euro(v) } } }
          }
        });
      } catch (e) {
        notify('Errore caricamento report', 'error');
      }
    };
    
    $('#loadReport').addEventListener('click', loadReportData);
    // 🔧 NUOVO: Handler per download CSV
$('#downloadReport').addEventListener('click', async () => {
  const month = $('#monthSelect').value;
  const year = $('#yearSelect').value;
  
  try {
    const response = await axios.get('/api/reports/monthly/download', {
      params: { year, month },
      headers: {
        'user-id': state.user?.id || '',
        'user-role': state.user?.role || ''
      },
      responseType: 'blob' // Importante per scaricare file binari
    });
    
    // Crea un link temporaneo per il download
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `report_${year}_${month}.csv`);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    
    notify('Report CSV scaricato con successo', 'success');
  } catch (error) {
    console.error('Errore download CSV:', error);
    notify('Errore durante il download del CSV', 'error');
  }
});

	await loadReportData();
  }

      /* ---------- Attività (Audit + Tempo su Clienti) ---------- */
  async function renderAudit() {
    const main = $('#main');

    // UI base
    main.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-semibold">Attività utenti</h2>
        <div class="flex gap-2 items-center">
          <input type="date" id="au_from" class="p-2 border rounded" />
          <input type="date" id="au_to" class="p-2 border rounded" />
          <select id="au_user" class="p-2 border rounded">
            <option value="">Tutti gli utenti</option>
            ${(state.vendors || []).map(v => `<option value="${v.id}">${v.nome_completo}</option>`).join('')}
          </select>
          <button id="au_load" class="px-3 py-2 bg-blue-500 text-white rounded">
            <i class="fas fa-sync mr-1"></i>Carica
          </button>
          <button id="au_export" class="px-3 py-2 bg-green-600 text-white rounded">
            <i class="fas fa-file-csv mr-1"></i>Esporta CSV
          </button>
        </div>
      </div>
 
      <div class="grid md:grid-cols-3 gap-4 mb-4">
        <div class="bg-white rounded-lg shadow p-4">
          <div class="text-gray-500 text-sm">Tempo totale</div>
          <div id="au_total_time" class="text-2xl font-bold">-</div>
        </div>
        <div class="bg-white rounded-lg shadow p-4">
          <div class="text-gray-500 text-sm">Azioni registrate</div>
          <div id="au_actions" class="text-2xl font-bold">-</div>
        </div>
        <div class="bg-white rounded-lg shadow p-4">
          <div class="text-gray-500 text-sm">Clienti coinvolti</div>
          <div id="au_customers" class="text-2xl font-bold">-</div>
        </div>
      </div>

      <div class="grid md:grid-cols-2 gap-4">
        <div class="bg-white rounded-lg shadow p-0 overflow-x-auto">
          <div class="p-4 font-semibold">Tempo per utente</div>
          <table class="min-w-full">
            <thead>
              <tr>
                <th class="px-4 py-2 text-left">Utente</th>
                <th class="px-4 py-2 text-right">Tempo</th>
              </tr>
            </thead>
            <tbody id="au_time_by_user"></tbody>
          </table>
        </div>
        <div class="bg-white rounded-lg shadow p-0 overflow-x-auto">
          <div class="p-4 font-semibold">Tempo per cliente</div>
          <table class="min-w-full">
            <thead>
              <tr>
                <th class="px-4 py-2 text-left">Cliente</th>
                <th class="px-4 py-2 text-right">Tempo</th>
              </tr>
            </thead>
            <tbody id="au_time_by_customer"></tbody>
          </table>
        </div>
      </div>

      <div class="bg-white rounded-lg shadow p-0 overflow-x-auto mt-4">
        <div class="p-4 font-semibold">Log dettagli</div>
        <table class="min-w-full">
          <thead>
            <tr>
              <th class="px-4 py-2 text-left">Data/Ora</th>
              <th class="px-4 py-2 text-left">Utente</th>
              <th class="px-4 py-2 text-left">Azione</th>
              <th class="px-4 py-2 text-left">Cliente</th>
              <th class="px-4 py-2 text-left">Dettagli</th>
              <th class="px-4 py-2 text-right">Durata</th>
            </tr>
          </thead>
          <tbody id="au_logs"></tbody>
        </table>
      </div>
    `;

    // util locale per formattare una durata in hh:mm
    const fmtDur = (sec) => {
      const s = Number(sec || 0);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      return (h ? h.toString().padStart(2, '0') : '00') + ':' + m.toString().padStart(2, '0');
    };

    // valori default (ultimo mese)
    const fromInp = $('#au_from');
    const toInp   = $('#au_to');
    const defTo   = dayjs().format('YYYY-MM-DD');
    const defFrom = dayjs().subtract(30, 'day').format('YYYY-MM-DD');
    fromInp.value = defFrom;
    toInp.value   = defTo;

    async function loadAudit() {
      if (state.user?.role !== 'admin') {
        notify('Solo gli admin possono accedere a questa sezione', 'error');
        goto('dashboard');
        return;
      }

      const from = fromInp.value || defFrom;
      const to   = toInp.value   || defTo;
      const user = $('#au_user').value || '';

      const query = new URLSearchParams({ from, to });
      if (user) query.append('user_id', user);

      // Endpoint previsto lato backend:
      // GET /api/audit?from=YYYY-MM-DD&to=YYYY-MM-DD[&user_id=]
      // Ritorno atteso:
      // { stats:{total_seconds, actions_count, unique_customers},
      //   time_by_user:[{user_id,user_name,seconds}],
      //   time_by_customer:[{customer_id,customer_name,seconds}],
      //   logs:[{when, user_name, action, customer_name, details, duration_sec}] }
      const res = await api('get', `/api/audit?${query.toString()}`);

      const stats = res.stats || {};
      $('#au_total_time').textContent = fmtDur(stats.total_seconds || 0);
      $('#au_actions').textContent    = (stats.actions_count || 0).toLocaleString('it-IT');
      $('#au_customers').textContent  = (stats.unique_customers || 0).toLocaleString('it-IT');

      const tUser = $('#au_time_by_user');
      const byUser = res.time_by_user || [];
      tUser.innerHTML = byUser.length ? byUser.map(r => `
        <tr class="hover:bg-gray-50 border-b">
          <td class="px-4 py-2">${r.user_name || r.user_id}</td>
          <td class="px-4 py-2 text-right font-semibold">${fmtDur(r.seconds)}</td>
        </tr>
      `).join('') : `<tr><td colspan="2" class="px-4 py-3 text-gray-500">Nessun dato</td></tr>`;

      const tCust = $('#au_time_by_customer');
      const byCust = res.time_by_customer || [];
      tCust.innerHTML = byCust.length ? byCust.map(r => `
        <tr class="hover:bg-gray-50 border-b">
          <td class="px-4 py-2">${r.customer_name || r.customer_id}</td>
          <td class="px-4 py-2 text-right font-semibold">${fmtDur(r.seconds)}</td>
        </tr>
      `).join('') : `<tr><td colspan="2" class="px-4 py-3 text-gray-500">Nessun dato</td></tr>`;

      const tLogs = $('#au_logs');
      const logs = res.logs || [];
      tLogs.innerHTML = logs.length ? logs.map(l => `
        <tr class="hover:bg-gray-50 border-b align-top">
          <td class="px-4 py-2 whitespace-nowrap">${l.when ? fmtDT(l.when) : ''}</td>
          <td class="px-4 py-2">${l.user_name || ''}</td>
          <td class="px-4 py-2">${l.action || ''}</td>
          <td class="px-4 py-2">${l.customer_name || ''}</td>
          <td class="px-4 py-2 text-sm text-gray-600">${l.details || ''}</td>
          <td class="px-4 py-2 text-right">${l.duration_sec != null ? fmtDur(l.duration_sec) : ''}</td>
        </tr>
      `).join('') : `<tr><td colspan="6" class="px-4 py-3 text-gray-500">Nessun log nel periodo selezionato</td></tr>`;

      // handler export CSV (tempo per cliente, per uso pratico)
      $('#au_export').onclick = () => {
        const rows = [
          ['Cliente','Secondi','HH:MM'],
          ...byCust.map(r => [ (r.customer_name || r.customer_id || ''), String(r.seconds || 0), fmtDur(r.seconds || 0) ])
        ];
        const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `attivita_tempo_clienti_${from}_${to}.csv`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      };
    }

    $('#au_load').addEventListener('click', loadAudit);
    await loadAudit();
  }


  /* ---------- Prodotti ---------- */
  async function renderProducts() {
    const main = $('#main');
    main.innerHTML = `
      <div class="flex justify-between items-center">
        <h2 class="text-xl font-semibold">Prodotti</h2>
        <button id="pr_new" class="px-3 py-2 bg-blue-500 text-white rounded">Nuovo prodotto</button>
      </div>
      <div class="bg-white rounded-lg shadow overflow-x-auto">
        <table class="min-w-full">
          <thead><tr>
           <th class="px-4 py-3 text-left">Codice</th>
            <th class="px-4 py-3 text-left">Nome</th>
            <th class="px-4 py-3 text-left">Categoria</th>
            <th class="px-4 py-3 text-left">Fornitore</th>
            <th class="px-4 py-3 text-left">Quantità</th>
            <th class="px-4 py-3 text-left">Prezzo</th>
            <th class="px-4 py-3 text-left">Giacenza</th>
          </tr></thead>
          <tbody id="pr_tbody"></tbody>
        </table>
      </div>
    `;
    
    const load = async () => {
      const { products } = await api('get', '/api/products');
      $('#pr_tbody').innerHTML = (products||[]).map(p => `
        <tr class="hover:bg-gray-50">
          <td class="px-4 py-3">${p.codice}</td>
          <td class="px-4 py-3">${p.nome}</td>
          <td class="px-4 py-3">${p.categoria || ''}</td>
          <td class="px-4 py-3">${p.fornitore || '-'}</td>
          <td class="px-4 py-3">${p.quantita || 1}</td>
          <td class="px-4 py-3">${euro(p.prezzo_vendita)}</td>
          <td class="px-4 py-3">${p.giacenza || 0}</td>
        </tr>
      `).join('');
    };
    await load();

    $('#pr_new').addEventListener('click', () => {
      const wrap = el('div', { class:'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
      const card = el('div', { class:'bg-white p-6 rounded-lg w-full max-w-md shadow-xl' }, `
        <h3 class="text-lg font-semibold mb-4">Nuovo prodotto</h3>
        <form id="prForm" class="space-y-3">
          <input name="codice" class="p-2 border rounded w-full" placeholder="Codice *" required />
          <input name="nome" class="p-2 border rounded w-full" placeholder="Nome *" required />
          <input name="categoria" class="p-2 border rounded w-full" placeholder="Categoria" />
          <input name="fornitore" class="p-2 border rounded w-full" placeholder="Fornitore (es. Ditta ABC)" />
          <input name="quantita" type="number" class="p-2 border rounded w-full" placeholder="Quantità (es. 4 per 4 finestre)" value="1" />
          <input name="prezzo_vendita" type="number" step="0.01" class="p-2 border rounded w-full" placeholder="Prezzo vendita *" required />
          <input name="prezzo_base" type="number" step="0.01" class="p-2 border rounded w-full" placeholder="Prezzo base" />
          <input name="giacenza" type="number" class="p-2 border rounded w-full" placeholder="Giacenza" />
          <div class="flex justify-end gap-2">
            <button type="button" id="close" class="px-3 py-2 border rounded">Annulla</button>
            <button class="px-3 py-2 bg-blue-500 text-white rounded">Crea</button>
          </div>
        </form>
      `);
      wrap.appendChild(card);
      document.body.appendChild(wrap);
      $('#close', card).addEventListener('click', () => wrap.remove());
      $('#prForm', card).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
       const body = Object.fromEntries(fd.entries());
        body.prezzo_vendita = Number(body.prezzo_vendita);
        body.prezzo_base = Number(body.prezzo_base || 0);
        body.giacenza = Number(body.giacenza || 0);
        body.quantita = Number(body.quantita || 1);
        await api('post', '/api/products', body);
        notify('Prodotto creato', 'success');
        wrap.remove();
        await load();
      });
    });
  }

  /* ---------- Utenti ---------- */
  async function renderUsers() {
    const main = $('#main');
    main.innerHTML = `
      <h2 class="text-xl font-semibold">Utenti</h2>
      <div class="bg-white rounded-lg shadow overflow-x-auto">
        <table class="min-w-full">
          <thead><tr>
            <th class="px-4 py-3 text-left">Nome</th>
            <th class="px-4 py-3 text-left">Username</th>
            <th class="px-4 py-3 text-left">Ruolo</th>
            <th class="px-4 py-3 text-left">Email</th>
            <th class="px-4 py-3 text-left">Telefono</th>
            <th class="px-4 py-3 text-left">Attivo</th>
          </tr></thead>
          <tbody id="u_tbody"></tbody>
        </table>
      </div>
    `;
    const { users } = await api('get', '/api/users');
    $('#u_tbody').innerHTML = (users||[]).map(u => `
      <tr class="hover:bg-gray-50">
        <td class="px-4 py-3">${u.nome_completo}</td>
        <td class="px-4 py-3">${u.username}</td>
        <td class="px-4 py-3">
          <span class="px-2 py-1 rounded text-xs ${u.role === 'admin' ? 'bg-purple-100' : 'bg-blue-100'}">${u.role}</span>
        </td>
        <td class="px-4 py-3">${u.email || ''}</td>
        <td class="px-4 py-3">${u.telefono || ''}</td>
        <td class="px-4 py-3">
          <span class="px-2 py-1 rounded text-xs ${u.attivo ? 'bg-green-100' : 'bg-red-100'}">${u.attivo ? 'Sì' : 'No'}</span>
        </td>
      </tr>
    `).join('');
  }

  /* ---------- Import Excel ---------- */
  async function renderImport() {
    const main = $('#main');
    main.innerHTML = `
      <div class="bg-white rounded-lg shadow p-6">
        <h2 class="text-xl font-semibold mb-3">Import clienti da Excel</h2>
        <div class="bg-blue-50 border border-blue-200 rounded p-4 mb-4">
          <h3 class="font-semibold text-blue-800 mb-2"><i class="fas fa-info-circle mr-2"></i>Come preparare il file</h3>
          <ul class="text-sm text-blue-700 space-y-1">
            <li>• Scarica il template Excel/CSV qui sotto</li>
            <li>• Compila le righe con i dati dei clienti</li>
            <li>• I campi <strong>nome</strong> e <strong>cognome</strong> sono obbligatori</li>
            <li>• Per <strong>assegnato_a</strong> usa: 1=admin, 2=narciso, 3=fabio, 4=max (o lascia vuoto)</li>
            <li>• Per <strong>stato</strong> usa: nuovo, richiamare, agendato con venditore, ecc.</li>
            <li>• Per <strong>data_richiamo</strong> usa formato: YYYY-MM-DD (es: 2024-12-15)</li>
          </ul>
        </div>
        <div class="flex items-center gap-3 mb-4">
          <button id="downloadTemplate" class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600">
            <i class="fas fa-download mr-2"></i>Scarica Template Excel
          </button>
          <span class="text-gray-500">⬅️ Prima scarica questo file di esempio</span>
        </div>
        <hr class="my-6">
        <p class="text-gray-600 mb-4">Dopo aver compilato il template, caricalo qui sotto per importare i clienti:</p>
        <div class="flex items-center gap-3">
          <input type="file" id="imp_file" accept=".xlsx,.xls,.csv" class="p-2 border rounded" />
          <button id="imp_go" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
            <i class="fas fa-upload mr-2"></i>Importa Clienti
          </button>
        </div>
        <div id="imp_result" class="mt-4"></div>
      </div>
    `;

    $('#downloadTemplate').addEventListener('click', async () => {
      try {
        const response = await fetch('/api/import/customers/template', {
          headers: { 'user-id': state.user?.id || '', 'user-role': state.user?.role || '' }
        });
        if (!response.ok) throw new Error('Errore nel download del template');
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'template_import_clienti.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        notify('Template scaricato con successo', 'success');
      } catch (e) {
        notify('Errore nel download del template', 'error');
      }
    });

    $('#imp_go').addEventListener('click', async () => {
      const f = $('#imp_file').files[0];
      if (!f) return notify('Seleziona un file', 'warn');
      const isCsv = f.name.toLowerCase().endsWith('.csv');
      let rows;

      if (isCsv) {
        const text = await f.text();
        const lines = text.split('\n').filter(line => line.trim() && !line.startsWith('#'));
        rows = lines.map(line => {
          const result = []; let current = ''; let inQuotes = false;
          for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') inQuotes = !inQuotes;
            else if (c === ',' && !inQuotes) { result.push(current.trim()); current=''; }
            else current += c;
          }
          result.push(current.trim()); return result;
        });
      } else {
        rows = await readXlsxFile(f);
      }
      if (!rows || rows.length < 2) return notify('File vuoto o senza intestazioni', 'warn');

      const header = rows[0].map(h => String(h || '').trim().toLowerCase());
      const idx = Object.fromEntries(header.map((h, i) => [h, i]));
      const getVal = (row, name) => {
        const i = idx[name]; if (i == null || i < 0) return null;
        const v = row[i]; if (v == null) return null;
        if (v instanceof Date) return dayjs(v).format('YYYY-MM-DD');
        return String(v).trim();
      };

      const customers = []; let skipped = 0;
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r] || [];
        if (!row.some(v => v != null && String(v).trim() !== '')) continue;

        const nome = getVal(row, 'nome');
        const cognome = getVal(row, 'cognome');
        if (!nome || !cognome) { skipped++; continue; }

        let data_richiamo = null;
        const rawDR = row[idx['data_richiamo']];
        if (rawDR instanceof Date) data_richiamo = dayjs(rawDR).format('YYYY-MM-DD');
        else if (typeof rawDR === 'string' && rawDR.trim()) data_richiamo = rawDR.trim().slice(0, 10);

        const assegnatoRaw = getVal(row, 'assegnato_a');
        const assegnato_a = assegnatoRaw && !Number.isNaN(Number(assegnatoRaw)) ? Number(assegnatoRaw) : null;

        customers.push({
          nome, cognome,
          email: getVal(row, 'email') || null,
          telefono: getVal(row, 'telefono') || null,
          azienda: getVal(row, 'azienda') || null,
          indirizzo: getVal(row, 'indirizzo') || null,
          citta: getVal(row, 'citta') || null,
          cap: getVal(row, 'cap') || null,
          provincia: getVal(row, 'provincia') || null,
          note: getVal(row, 'note') || null,
          assegnato_a,
          stato: getVal(row, 'stato') || 'nuovo',
          data_richiamo
        });
      }

      if (!customers.length) return notify('Nessun cliente valido trovato nel file', 'warn');

      $('#imp_result').innerHTML = `
        <div class="text-sm text-gray-600 mb-2">
          Trovati ${customers.length} clienti validi ${skipped ? `(righe saltate: ${skipped})` : ''}. Avvio import...
        </div>
      `;

      const btn = $('#imp_go');
      btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Import in corso...';

      try {
        const res = await api('post', '/api/import/customers', { customers });
        const errs = res.errors || [];
        $('#imp_result').innerHTML = `
          <div class="p-3 rounded bg-green-50 border border-green-200 mb-3">
            <div class="font-semibold text-green-700">Import completato</div>
            <div class="text-sm text-green-700">Importati ${res.imported} clienti su ${customers.length}.</div>
          </div>
          ${errs.length ? `
            <div class="p-3 rounded bg-yellow-50 border border-yellow-200">
              <div class="font-semibold text-yellow-700 mb-2">Errori (${errs.length})</div>
              <div class="space-y-2 max-h-64 overflow-auto">
                ${errs.map(e => `
                  <div class="text-sm">
                    <span class="text-red-700 font-medium">${e.error || 'Errore'}</span>
                    <pre class="bg-white border rounded p-2 overflow-auto mt-1 text-xs">${JSON.stringify(e.row, null, 2)}</pre>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        `;
        notify(res.message || 'Import eseguito', 'success');
      } catch (e) {
        /* api() notifica già l'errore */
      } finally {
        btn.disabled = false; 
        btn.innerHTML = '<i class="fas fa-upload mr-2"></i>Importa Clienti';
      }
    });
  }

  
  /* -------------------- Boot -------------------- */
  async function boot() {
    const u = loadSession();
    if (u) {
      state.user = u;
      setHeadersForUser(u);
      await loadVendors();
     
      renderShell();
      
    } else {
      renderLogin();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
 
 /* ==================== MONTAGGIO EXPRESS ==================== */
  
  window.openMontaggioExpressModal = function() {
    const modal = `
      <div id="montaggioExpressModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto p-4">
        <div class="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
          <div class="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
            <h3 class="text-xl font-bold text-gray-800">
              <i class="fas fa-rocket mr-2 text-green-500"></i>
              Montaggio Veloce
            </h3>
            <button onclick="closeMontaggioExpressModal()" class="text-gray-500 hover:text-gray-700">
              <i class="fas fa-times text-xl"></i>
            </button>
          </div>

          <form id="montaggioExpressForm" class="p-6 space-y-6">
            <!-- SEZIONE 1: Dati Cliente -->
            <div class="bg-blue-50 p-4 rounded-lg">
              <h4 class="font-bold text-blue-800 mb-3 flex items-center">
                <i class="fas fa-user mr-2"></i>1. Dati Cliente
              </h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium mb-1">Nome *</label>
                  <input type="text" id="express_nome" required class="w-full p-2 border rounded">
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Cognome *</label>
                  <input type="text" id="express_cognome" required class="w-full p-2 border rounded">
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Telefono *</label>
                  <input type="tel" id="express_telefono" required class="w-full p-2 border rounded">
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Email</label>
                  <input type="email" id="express_email" class="w-full p-2 border rounded">
                </div>
                <div class="md:col-span-2">
                  <label class="block text-sm font-medium mb-1">Indirizzo completo</label>
                  <input type="text" id="express_indirizzo" placeholder="Via Roma 123" class="w-full p-2 border rounded">
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Città</label>
                  <input type="text" id="express_citta" class="w-full p-2 border rounded">
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">CAP</label>
                  <input type="text" id="express_cap" class="w-full p-2 border rounded">
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Provincia</label>
                  <input type="text" id="express_provincia" maxlength="2" class="w-full p-2 border rounded" placeholder="MI">
                </div>
              </div>
            </div>

            <!-- SEZIONE 2: Dati Contratto -->
            <div class="bg-purple-50 p-4 rounded-lg">
              <h4 class="font-bold text-purple-800 mb-3 flex items-center">
                <i class="fas fa-file-contract mr-2"></i>2. Dati Contratto
              </h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium mb-1">Importo Vendita (€) *</label>
                  <input type="number" id="express_importo" required min="0" step="0.01" class="w-full p-2 border rounded">
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Venditore</label>
                  <select id="express_venditore" class="w-full p-2 border rounded">
                    <option value="">-- Seleziona venditore --</option>
                  </select>
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Data Firma Contratto</label>
                  <input type="date" id="express_data_vendita" class="w-full p-2 border rounded">
                </div>
              </div>
            </div>

            <!-- SEZIONE 3: Prodotti da Montare -->
            <div class="bg-orange-50 p-4 rounded-lg">
              <h4 class="font-bold text-orange-800 mb-3 flex items-center">
                <i class="fas fa-boxes mr-2"></i>3. Prodotti da Montare *
              </h4>
              <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                <label class="flex items-center space-x-2 p-2 border rounded hover:bg-orange-100 cursor-pointer">
                  <input type="checkbox" value="infissi" class="express-prodotto">
                  <span>Infissi</span>
                </label>
                <label class="flex items-center space-x-2 p-2 border rounded hover:bg-orange-100 cursor-pointer">
                  <input type="checkbox" value="tapparelle" class="express-prodotto">
                  <span>Tapparelle</span>
                </label>
                <label class="flex items-center space-x-2 p-2 border rounded hover:bg-orange-100 cursor-pointer">
                  <input type="checkbox" value="zanzariere" class="express-prodotto">
                  <span>Zanzariere</span>
                </label>
                <label class="flex items-center space-x-2 p-2 border rounded hover:bg-orange-100 cursor-pointer">
                  <input type="checkbox" value="scuri" class="express-prodotto">
                  <span>Scuri</span>
                </label>
                <label class="flex items-center space-x-2 p-2 border rounded hover:bg-orange-100 cursor-pointer">
                  <input type="checkbox" value="porta_blindata" class="express-prodotto">
                  <span>Porta Blindata</span>
                </label>
                <label class="flex items-center space-x-2 p-2 border rounded hover:bg-orange-100 cursor-pointer">
                  <input type="checkbox" value="porte_interne" class="express-prodotto">
                  <span>Porte Interne</span>
                </label>
                <label class="flex items-center space-x-2 p-2 border rounded hover:bg-orange-100 cursor-pointer">
                  <input type="checkbox" value="veneziane" class="express-prodotto">
                  <span>Veneziane</span>
                </label>
                <label class="flex items-center space-x-2 p-2 border rounded hover:bg-orange-100 cursor-pointer">
                  <input type="checkbox" value="pergole" class="express-prodotto">
                  <span>Pergole</span>
                </label>
              </div>
            </div>

            <!-- SEZIONE 4: Dettagli Montaggio -->
            <div class="bg-green-50 p-4 rounded-lg">
              <h4 class="font-bold text-green-800 mb-3 flex items-center">
                <i class="fas fa-calendar-check mr-2"></i>4. Dettagli Montaggio (opzionale)
              </h4>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium mb-1">Data Montaggio</label>
                  <input type="date" id="express_data_montaggio" class="w-full p-2 border rounded">
                </div>
                <div>
                  <label class="block text-sm font-medium mb-1">Ora Montaggio</label>
                  <input type="time" id="express_ora_montaggio" class="w-full p-2 border rounded">
                </div>
                <div class="md:col-span-2">
                  <label class="block text-sm font-medium mb-1">Montatori</label>
                  <input type="text" id="express_montatori" placeholder="Mario, Luigi" class="w-full p-2 border rounded">
                </div>
                <div class="md:col-span-2">
                  <label class="block text-sm font-medium mb-1">Note Montaggio</label>
                  <textarea id="express_note" rows="3" class="w-full p-2 border rounded"></textarea>
                </div>
              </div>
            </div>

            <!-- Bottoni -->
            <div class="flex justify-end space-x-3 pt-4 border-t">
              <button type="button" onclick="closeMontaggioExpressModal()" class="px-4 py-2 border rounded hover:bg-gray-100">
                Annulla
              </button>
              <button type="submit" class="px-6 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition">
                <i class="fas fa-save mr-2"></i>Salva e Crea Montaggio
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modal);

    // Carica lista venditori
    loadVendorsForExpress();

    // Imposta data odierna
    document.getElementById('express_data_vendita').value = new Date().toISOString().split('T')[0];

    // Form submit
    document.getElementById('montaggioExpressForm').addEventListener('submit', saveMontaggioExpress);
  }

  window.closeMontaggioExpressModal = function() {
    const modal = document.getElementById('montaggioExpressModal');
    if (modal) modal.remove();
  }

  async function loadVendorsForExpress() {
    try {
      const res = await api('get', '/api/vendors');
      const select = document.getElementById('express_venditore');
      
      if (res.success && res.vendors) {
        res.vendors.forEach(v => {
          if (v.id !== 0) {
            const opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.nome_completo;
            select.appendChild(opt);
          }
        });

        if (state.user && state.user.id) {
          select.value = state.user.id;
        }
      }
    } catch (err) {
      console.error('Errore caricamento venditori:', err);
    }
  }

  async function saveMontaggioExpress(e) {
    e.preventDefault();

    const prodottiSelezionati = Array.from(document.querySelectorAll('.express-prodotto:checked'))
      .map(cb => cb.value);

    if (prodottiSelezionati.length === 0) {
      alert('⚠️ Seleziona almeno un prodotto da montare');
      return;
    }

    const importo = document.getElementById('express_importo').value;
    if (!importo || Number(importo) <= 0) {
      alert('⚠️ Inserisci un importo valido');
      return;
    }

    const payload = {
      nome: document.getElementById('express_nome').value,
      cognome: document.getElementById('express_cognome').value,
      telefono: document.getElementById('express_telefono').value,
      email: document.getElementById('express_email').value || null,
      indirizzo: document.getElementById('express_indirizzo').value || null,
      citta: document.getElementById('express_citta').value || null,
      cap: document.getElementById('express_cap').value || null,
      provincia: document.getElementById('express_provincia').value || null,
      importo: Number(importo),
      venditore_id: Number(document.getElementById('express_venditore').value) || state.user.id,
      data_vendita: document.getElementById('express_data_vendita').value || null,
      prodotti_selezionati: prodottiSelezionati,
      data_montaggio: document.getElementById('express_data_montaggio').value || null,
      ora_montaggio: document.getElementById('express_ora_montaggio').value || null,
      montatori: document.getElementById('express_montatori').value || null,
      note: document.getElementById('express_note').value || null
    };

    try {
      const res = await api('post', '/api/montaggi/express', payload);
      
if (res.success) {
        const isExisting = res.cliente_esistente ? '(Cliente esistente aggiornato)' : '(Nuovo cliente creato)';
        
        alert('✅ Montaggio creato con successo! ' + isExisting + '\n\n' +
              `Cliente: ${payload.nome} ${payload.cognome}\n` +
              `Prodotti: ${prodottiSelezionati.join(', ')}\n` +
              `Importo: €${payload.importo}`);
        
        closeMontaggioExpressModal();
        if (typeof renderMontaggi === 'function') {
          renderMontaggi();
        }
      }
    } catch (err) {
      console.error('Errore salvataggio montaggio express:', err);
      alert('❌ Errore: ' + (err.response?.data?.error || err.message || 'Errore sconosciuto'));
    }
  }

 /* ==================== GESTIONE DOPPIONI ORDINI ==================== */
  
  window.findDuplicateOrders = async function() {
    try {
      const res = await api('get', '/api/sales/duplicates');
      
      if (!res.success || !res.duplicates || res.duplicates.length === 0) {
        alert('✅ Nessun doppione trovato! Tutti gli ordini sono unici.');
        return;
      }

      const modal = `
        <div id="duplicatesModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto p-4">
          <div class="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div class="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
              <h3 class="text-xl font-bold text-gray-800">
                <i class="fas fa-exclamation-triangle mr-2 text-orange-500"></i>
                Ordini Duplicati Trovati (${res.duplicates.length} clienti)
              </h3>
              <button onclick="closeDuplicatesModal()" class="text-gray-500 hover:text-gray-700">
                <i class="fas fa-times text-xl"></i>
              </button>
            </div>

            <div class="p-6 space-y-4">
              ${res.duplicates.map(d => {
                const saleIds = (d.sale_ids || '').split(',');
                const numeriOrdine = (d.numeri_ordine || '').split(',');
                const importi = (d.importi || '').split(',');
                
                return `
                  <div class="bg-orange-50 p-4 rounded-lg border border-orange-200">
                    <div class="font-bold text-lg mb-2">
                      ${d.cliente} - ${d.telefono || 'No telefono'}
                    </div>
                    <div class="text-sm text-gray-600 mb-3">
                      ${d.num_vendite} vendite duplicate trovate
                    </div>
                    <div class="space-y-2">
                      ${saleIds.map((saleId, i) => `
                        <div class="flex justify-between items-center bg-white p-3 rounded border">
                          <div>
                            <div class="font-medium">Vendita #${saleId}</div>
                            <div class="text-sm text-gray-600">N° Ordine: ${numeriOrdine[i] || '-'}</div>
                            <div class="text-sm text-green-600 font-medium">Importo: €${importi[i] || '0'}</div>
                          </div>
                          <button onclick="deleteDuplicateSale(${saleId}, ${d.customer_id})" 
                                  class="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">
                            <i class="fas fa-trash mr-1"></i>Elimina
                          </button>
                        </div>
                      `).join('')}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>

            <div class="sticky bottom-0 bg-white border-t px-6 py-4 flex justify-end">
              <button onclick="closeDuplicatesModal()" class="px-4 py-2 border rounded hover:bg-gray-100">
                Chiudi
              </button>
            </div>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modal);
    } catch (err) {
      console.error('Errore ricerca doppioni:', err);
      alert('❌ Errore: ' + (err.message || 'Impossibile cercare doppioni'));
    }
  }

  window.closeDuplicatesModal = function() {
    const modal = document.getElementById('duplicatesModal');
    if (modal) modal.remove();
  }

  window.deleteDuplicateSale = async function(saleId, customerId) {
    if (!confirm(`⚠️ ATTENZIONE!\n\nEliminare definitivamente la vendita #${saleId}?\n\nVerranno eliminati anche:\n- Ordini collegati\n- Prodotti ordine\n- Montaggi programmati\n\nQuesta azione è IRREVERSIBILE!`)) {
      return;
    }

    try {
      const res = await api('delete', `/api/sales/${saleId}/force`);
      
      if (res.success) {
        alert('✅ Vendita eliminata con successo!');
        closeDuplicatesModal();
        if (typeof renderOrders === 'function') {
          renderOrders();
        }
      }
    } catch (err) {
      console.error('Errore eliminazione vendita:', err);
      alert('❌ Errore: ' + (err.message || 'Impossibile eliminare la vendita'));
    }
  }

  /* ==================== MODIFICA ORDINE ==================== */
  
  window.openEditOrderModal = async function(orderId, event) {
    if (event) event.stopPropagation();

    try {
      const { orders } = await api('get', '/api/orders');
      const order = orders.find(o => o.id == orderId);
      
      if (!order) {
        alert('❌ Ordine non trovato');
        return;
      }

      const items = order.items || [];
      const selectedProducts = items.filter(i => i.selezionato).map(i => i.product_type);

      const modal = `
        <div id="editOrderModal" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto p-4">
          <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div class="sticky top-0 bg-white border-b px-6 py-4 flex justify-between items-center">
              <h3 class="text-xl font-bold text-gray-800">
                <i class="fas fa-edit mr-2 text-blue-500"></i>
                Modifica Ordine #${orderId}
              </h3>
              <button onclick="closeEditOrderModal()" class="text-gray-500 hover:text-gray-700">
                <i class="fas fa-times text-xl"></i>
              </button>
            </div>

            <form id="editOrderForm" class="p-6 space-y-6">
              <input type="hidden" id="edit_order_id" value="${orderId}">
              <input type="hidden" id="edit_sale_id" value="${order.sale_id || ''}">

              <!-- Cliente -->
              <div class="bg-gray-50 p-4 rounded-lg">
                <div class="font-bold text-gray-800 mb-2">Cliente</div>
                <div class="text-lg">${order.cliente || 'Sconosciuto'}</div>
                <div class="text-sm text-gray-600">${order.cliente_telefono || ''}</div>
                <div class="text-sm text-gray-600">${order.cliente_indirizzo || ''}</div>
              </div>

              <!-- Importo Contratto -->
              <div class="bg-green-50 p-4 rounded-lg">
                <label class="block font-bold text-gray-800 mb-2">
                  <i class="fas fa-euro-sign mr-2"></i>Importo Contratto
                </label>
                <input type="number" id="edit_importo" value="${order.importo_vendita || 0}" 
                       min="0" step="0.01" required
                       class="w-full p-3 border-2 rounded-lg text-lg font-semibold">
              </div>

              <!-- Prodotti -->
              <div class="bg-blue-50 p-4 rounded-lg">
                <label class="block font-bold text-gray-800 mb-3">
                  <i class="fas fa-boxes mr-2"></i>Prodotti da Montare
                </label>
                <div class="grid grid-cols-2 gap-3">
                  <label class="flex items-center space-x-2 p-3 border-2 rounded-lg hover:bg-blue-100 cursor-pointer ${selectedProducts.includes('infissi') ? 'bg-blue-100 border-blue-500' : 'bg-white'}">
                    <input type="checkbox" value="infissi" class="edit-prodotto" ${selectedProducts.includes('infissi') ? 'checked' : ''}>
                    <span class="font-medium">Infissi</span>
                  </label>
                  <label class="flex items-center space-x-2 p-3 border-2 rounded-lg hover:bg-blue-100 cursor-pointer ${selectedProducts.includes('tapparelle') ? 'bg-blue-100 border-blue-500' : 'bg-white'}">
                    <input type="checkbox" value="tapparelle" class="edit-prodotto" ${selectedProducts.includes('tapparelle') ? 'checked' : ''}>
                    <span class="font-medium">Tapparelle</span>
                  </label>
                  <label class="flex items-center space-x-2 p-3 border-2 rounded-lg hover:bg-blue-100 cursor-pointer ${selectedProducts.includes('zanzariere') ? 'bg-blue-100 border-blue-500' : 'bg-white'}">
                    <input type="checkbox" value="zanzariere" class="edit-prodotto" ${selectedProducts.includes('zanzariere') ? 'checked' : ''}>
                    <span class="font-medium">Zanzariere</span>
                  </label>
                  <label class="flex items-center space-x-2 p-3 border-2 rounded-lg hover:bg-blue-100 cursor-pointer ${selectedProducts.includes('scuri') ? 'bg-blue-100 border-blue-500' : 'bg-white'}">
                    <input type="checkbox" value="scuri" class="edit-prodotto" ${selectedProducts.includes('scuri') ? 'checked' : ''}>
                    <span class="font-medium">Scuri</span>
                  </label>
                  <label class="flex items-center space-x-2 p-3 border-2 rounded-lg hover:bg-blue-100 cursor-pointer ${selectedProducts.includes('porta_blindata') ? 'bg-blue-100 border-blue-500' : 'bg-white'}">
                    <input type="checkbox" value="porta_blindata" class="edit-prodotto" ${selectedProducts.includes('porta_blindata') ? 'checked' : ''}>
                    <span class="font-medium">Porta Blindata</span>
                  </label>
                  <label class="flex items-center space-x-2 p-3 border-2 rounded-lg hover:bg-blue-100 cursor-pointer ${selectedProducts.includes('porte_interne') ? 'bg-blue-100 border-blue-500' : 'bg-white'}">
                    <input type="checkbox" value="porte_interne" class="edit-prodotto" ${selectedProducts.includes('porte_interne') ? 'checked' : ''}>
                    <span class="font-medium">Porte Interne</span>
                  </label>
                  <label class="flex items-center space-x-2 p-3 border-2 rounded-lg hover:bg-blue-100 cursor-pointer ${selectedProducts.includes('veneziane') ? 'bg-blue-100 border-blue-500' : 'bg-white'}">
                    <input type="checkbox" value="veneziane" class="edit-prodotto" ${selectedProducts.includes('veneziane') ? 'checked' : ''}>
                    <span class="font-medium">Veneziane</span>
                  </label>
                  <label class="flex items-center space-x-2 p-3 border-2 rounded-lg hover:bg-blue-100 cursor-pointer ${selectedProducts.includes('pergole') ? 'bg-blue-100 border-blue-500' : 'bg-white'}">
                    <input type="checkbox" value="pergole" class="edit-prodotto" ${selectedProducts.includes('pergole') ? 'checked' : ''}>
                    <span class="font-medium">Pergole</span>
                  </label>
                </div>
              </div>

              <!-- Bottoni -->
              <div class="flex justify-end space-x-3 pt-4 border-t">
                <button type="button" onclick="closeEditOrderModal()" class="px-4 py-2 border rounded hover:bg-gray-100">
                  Annulla
                </button>
                <button type="submit" class="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition">
                  <i class="fas fa-save mr-2"></i>Salva Modifiche
                </button>
              </div>
            </form>
          </div>
        </div>
      `;

      document.body.insertAdjacentHTML('beforeend', modal);
      document.getElementById('editOrderForm').addEventListener('submit', saveOrderEdit);
    } catch (err) {
      console.error('Errore apertura modal modifica:', err);
      alert('❌ Errore: ' + (err.message || 'Impossibile aprire modal'));
    }
  }

  window.closeEditOrderModal = function() {
    const modal = document.getElementById('editOrderModal');
    if (modal) modal.remove();
  }

  async function saveOrderEdit(e) {
    e.preventDefault();

    const saleId = document.getElementById('edit_sale_id').value;
    const importo = document.getElementById('edit_importo').value;
    const prodottiSelezionati = Array.from(document.querySelectorAll('.edit-prodotto:checked'))
      .map(cb => cb.value);

    if (!importo || Number(importo) <= 0) {
      alert('⚠️ Inserisci un importo valido');
      return;
    }

    if (prodottiSelezionati.length === 0) {
      alert('⚠️ Seleziona almeno un prodotto');
      return;
    }

    const payload = {
      totale: Number(importo),
      prodotti_selezionati: prodottiSelezionati
    };

    try {
      const res = await api('put', `/api/sales/${saleId}/update`, payload);
      
      if (res.success) {
        alert('✅ Ordine aggiornato con successo!\n\n' +
              `Importo: €${importo}\n` +
              `Prodotti: ${prodottiSelezionati.join(', ')}`);
        
        closeEditOrderModal();
        if (typeof renderOrders === 'function') {
          renderOrders();
        }
      }
    } catch (err) {
      console.error('Errore salvataggio modifica:', err);
      alert('❌ Errore: ' + (err.message || 'Impossibile salvare le modifiche'));
    }

  }
  /* ==================== PRESENZE ==================== */
  
  function getPCFingerprint() {
    return btoa(navigator.userAgent + screen.width + 'x' + screen.height + navigator.language);
  }
  
  // ==================== PRESENZE ====================
  
  async function renderPresenze() {
    const main = $('#main');
    const oggi = new Date();
    const meseCorrente = `${oggi.getFullYear()}-${String(oggi.getMonth() + 1).padStart(2, '0')}`;
    
    // Controllo permessi
    const hasPresenze = Array.isArray(state.user?.scopes) && state.user.scopes.includes('presenze');
    if (state.user?.role !== 'admin' && !hasPresenze) {
      main.innerHTML = '<div class="bg-red-50 border border-red-200 rounded p-4 text-red-700">Accesso negato: non hai i permessi per visualizzare le presenze.</div>';
      return;
    }
    
    main.innerHTML = `
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-xl font-semibold"><i class="fas fa-clock mr-2"></i>Presenze</h2>
        <div class="flex gap-2">
          <input type="month" id="filtroMese" value="${meseCorrente}" class="p-2 border rounded" />
          <select id="filtroUser" class="p-2 border rounded">
            <option value="">Tutti gli utenti</option>
          </select>
          <button id="btnAggiungiManuale" class="px-3 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition">
            <i class="fas fa-plus mr-1"></i>Aggiungi Manuale
          </button>
          <button id="btnExport" class="px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition">
            <i class="fas fa-file-csv mr-1"></i>Esporta CSV
          </button>
        </div>
      </div>
      
      <div id="listaPresenze" class="bg-white rounded-lg shadow overflow-x-auto">
        <p class="p-4 text-gray-500">Caricamento...</p>
      </div>
    `;
    
    // Carica lista utenti per filtro
    const loadUsers = async () => {
      const { vendors } = await api('get', '/api/vendors');
      const filtroUser = $('#filtroUser');
      if (filtroUser) {
        vendors.forEach(v => {
          filtroUser.innerHTML += `<option value="${v.id}">${v.nome_completo}</option>`;
        });
      }
    };
    
    // Carica presenze con filtri
    const caricaPresenze = async () => {
      const mese = $('#filtroMese')?.value || '';
      const userId = $('#filtroUser')?.value || '';
      const params = new URLSearchParams();
      if (mese) params.append('mese', mese);
      if (userId) params.append('user_id', userId);
      
      try {
        const { presenze } = await api('get', `/api/presenze?${params}`);
        const lista = $('#listaPresenze');
        
        if (!lista) return;
        
        if (!presenze || presenze.length === 0) {
          lista.innerHTML = '<p class="p-4 text-gray-500">Nessuna presenza trovata</p>';
          return;
        }
        
        lista.innerHTML = `
          <table class="min-w-full">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-2 text-left">Data</th>
                <th class="px-4 py-2 text-left">Utente</th>
                <th class="px-4 py-2 text-left">Entrata</th>
                <th class="px-4 py-2 text-left">Uscita</th>
                <th class="px-4 py-2 text-left">Ore</th>
                <th class="px-4 py-2 text-left">Tipo</th>
                <th class="px-4 py-2 text-left">Note</th>
                <th class="px-4 py-2 text-left">Azioni</th>
              </tr>
            </thead>
            <tbody>
              ${presenze.map(p => {
                let ore = '-';
                if (p.ora_entrata && p.ora_uscita) {
                  const entrata = new Date(`2000-01-01T${p.ora_entrata}`);
                  const uscita = new Date(`2000-01-01T${p.ora_uscita}`);
                  ore = ((uscita - entrata) / 1000 / 60 / 60).toFixed(1) + 'h';
                }
                const tipoColors = {
                  'lavoro': 'bg-green-100 text-green-800',
                  'ferie': 'bg-blue-100 text-blue-800',
                  'malattia': 'bg-red-100 text-red-800',
                  'permesso': 'bg-yellow-100 text-yellow-800'
                };
                const tipoColor = tipoColors[p.tipo] || 'bg-gray-100 text-gray-800';
                
                return `
                  <tr class="border-t hover:bg-gray-50">
                    <td class="px-4 py-2">${new Date(p.data).toLocaleDateString('it-IT')}</td>
                    <td class="px-4 py-2">${p.nome_completo || '-'}</td>
                    <td class="px-4 py-2">${p.ora_entrata || '-'}</td>
                    <td class="px-4 py-2">${p.ora_uscita || '-'}</td>
                    <td class="px-4 py-2 font-semibold">${ore}</td>
                    <td class="px-4 py-2">
                      <span class="px-2 py-1 rounded text-xs ${tipoColor}">${p.tipo}</span>
                    </td>
                    <td class="px-4 py-2 text-sm text-gray-600">${p.note || '-'}</td>
                    <td class="px-4 py-2">
                      <button onclick="deletePresenza(${p.id})" class="text-red-600 hover:text-red-800">
                        <i class="fas fa-trash"></i>
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        `;
      } catch (err) {
        console.error('Errore caricamento presenze:', err);
        const lista = $('#listaPresenze');
        if (lista) {
          lista.innerHTML = '<p class="p-4 text-red-500">Errore nel caricamento delle presenze</p>';
        }
      }
    };
    
    // Mostra form inserimento manuale
    const mostraFormManuale = async () => {
      const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
      const card = el('div', { class: 'bg-white p-6 rounded-lg w-full max-w-md shadow-xl' });
      
      const { vendors } = await api('get', '/api/vendors');
      
      card.innerHTML = `
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-semibold">Inserimento Manuale</h3>
          <button id="closeModal" class="text-gray-400 hover:text-gray-600">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <form id="formManuale" class="space-y-3">
          <div>
            <label class="block text-sm font-medium mb-1">Utente *</label>
            <select id="userId" required class="p-2 border rounded w-full">
              <option value="">Seleziona utente</option>
              ${vendors.map(v => `<option value="${v.id}">${v.nome_completo}</option>`).join('')}
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Data *</label>
            <input type="date" id="data" required class="p-2 border rounded w-full" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Tipo *</label>
            <select id="tipo" required class="p-2 border rounded w-full">
              <option value="lavoro">Lavoro</option>
              <option value="ferie">Ferie</option>
              <option value="malattia">Malattia</option>
              <option value="permesso">Permesso</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Ora Entrata</label>
            <input type="time" id="ora_entrata" class="p-2 border rounded w-full" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Ora Uscita</label>
            <input type="time" id="ora_uscita" class="p-2 border rounded w-full" />
          </div>
          <div>
            <label class="block text-sm font-medium mb-1">Note</label>
            <textarea id="note" rows="3" class="p-2 border rounded w-full"></textarea>
          </div>
          <div class="flex gap-2 pt-2">
            <button type="button" id="cancelBtn" class="px-4 py-2 border rounded flex-1 hover:bg-gray-50">
              Annulla
            </button>
            <button type="submit" class="px-4 py-2 bg-green-500 text-white rounded flex-1 hover:bg-green-600">
              Salva
            </button>
          </div>
        </form>
      `;
      
      wrap.appendChild(card);
      document.body.appendChild(wrap);
      
      const close = () => wrap.remove();
      $('#closeModal').addEventListener('click', close);
      $('#cancelBtn').addEventListener('click', close);
      
      $('#formManuale').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
          user_id: Number($('#userId').value),
          data: $('#data').value,
          tipo: $('#tipo').value,
          ora_entrata: $('#ora_entrata').value || null,
          ora_uscita: $('#ora_uscita').value || null,
          note: $('#note').value || null
        };
        
        try {
          await api('post', '/api/presenze/manuale', body);
          notify('Presenza inserita', 'success');
          close();
          await caricaPresenze();
        } catch (err) {
          console.error('Errore inserimento presenza:', err);
          notify('Errore inserimento presenza', 'error');
        }
      });
    };
    
    // Esporta CSV
    const esportaCSV = async () => {
      const mese = $('#filtroMese')?.value || '';
      const userId = $('#filtroUser')?.value || '';
      const params = new URLSearchParams();
      if (mese) params.append('mese', mese);
      if (userId) params.append('user_id', userId);
      
      try {
        const { presenze } = await api('get', `/api/presenze?${params}`);
        
        if (!presenze || presenze.length === 0) {
          notify('Nessun dato da esportare', 'warning');
          return;
        }
        
        const csv = ['Data,Utente,Entrata,Uscita,Ore,Tipo,Note'];
        presenze.forEach(p => {
          let ore = '-';
          if (p.ora_entrata && p.ora_uscita) {
            const entrata = new Date(`2000-01-01T${p.ora_entrata}`);
            const uscita = new Date(`2000-01-01T${p.ora_uscita}`);
            ore = ((uscita - entrata) / 1000 / 60 / 60).toFixed(1);
          }
          csv.push([
            new Date(p.data).toLocaleDateString('it-IT'),
            p.nome_completo || '-',
            p.ora_entrata || '-',
            p.ora_uscita || '-',
            ore,
            p.tipo || '-',
            (p.note || '-').replace(/,/g, ';')
          ].join(','));
        });
        
        const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `presenze_${mese || 'export'}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        notify('CSV esportato', 'success');
      } catch (err) {
        console.error('Errore esportazione CSV:', err);
        notify('Errore esportazione CSV', 'error');
      }
    };
    
    // Elimina presenza
    window.deletePresenza = async (id) => {
      if (!confirm('Eliminare questa presenza?')) return;
      
      try {
        await api('delete', `/api/presenze/${id}`);
        notify('Presenza eliminata', 'success');
        await caricaPresenze();
      } catch (err) {
        console.error('Errore eliminazione presenza:', err);
        notify('Errore eliminazione presenza', 'error');
      }
    };
    
    // Inizializza
    await loadUsers();
    await caricaPresenze();
    
    // Event listeners
    const filtroMeseEl = $('#filtroMese');
    const filtroUserEl = $('#filtroUser');
    const btnAggiungiEl = $('#btnAggiungiManuale');
    const btnExportEl = $('#btnExport');
    
    if (filtroMeseEl) filtroMeseEl.addEventListener('change', caricaPresenze);
    if (filtroUserEl) filtroUserEl.addEventListener('change', caricaPresenze);
    if (btnAggiungiEl) btnAggiungiEl.addEventListener('click', mostraFormManuale);
    if (btnExportEl) btnExportEl.addEventListener('click', esportaCSV);
  }
  
  // Funzioni per timbratura (chiamate dopo login)
  async function mostraTimbraturaEntrata() {
    if (!state.user) return;
    
    try {
      const { presenza } = await api('get', '/api/presenze/oggi');
      if (presenza && presenza.ora_entrata) {
        console.log('✅ Presenza già registrata oggi');
        return;
      }
    } catch (err) {
      console.error('Errore verifica presenza:', err);
    }
    
    const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
    const card = el('div', { class: 'bg-white p-6 rounded-lg w-full max-w-md shadow-xl' });
    
    card.innerHTML = `
      <h3 class="text-lg font-semibold mb-4">Conferma Presenza</h3>
      <p class="text-gray-600 mb-4">Buongiorno ${state.user.nome_completo || state.user.username}! Conferma la tua presenza di oggi.</p>
      <form id="formTimbratura" class="space-y-3">
        <div>
          <label class="block text-sm font-medium mb-1">Password</label>
          <input type="password" id="passwordTimbratura" required class="p-2 border rounded w-full" />
        </div>
        <div class="flex gap-2">
          <button type="button" id="cancelTimbratura" class="px-4 py-2 border rounded flex-1">
            Dopo
          </button>
          <button type="submit" class="px-4 py-2 bg-green-500 text-white rounded flex-1">
            Conferma
          </button>
        </div>
      </form>
    `;
    
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    
    const close = () => wrap.remove();
    $('#cancelTimbratura').addEventListener('click', close);
    
    $('#formTimbratura').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = $('#passwordTimbratura').value;
      
      try {
        await api('post', '/api/presenze/entrata', { password });
        notify('Presenza registrata', 'success');
        close();
        aggiornaStatoPresenza();
      } catch (err) {
        console.error('Errore timbratura:', err);
        notify('Errore timbratura: ' + (err.message || 'Password errata'), 'error');
      }
    });
  }
  
  async function mostraTimbraturaUscita() {
    if (!state.user) return;
    
    const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
    const card = el('div', { class: 'bg-white p-6 rounded-lg w-full max-w-md shadow-xl' });
    
    card.innerHTML = `
      <h3 class="text-lg font-semibold mb-4">Timbra Uscita</h3>
      <p class="text-gray-600 mb-4">Confermi l'uscita?</p>
      <div class="flex gap-2">
        <button id="cancelUscita" class="px-4 py-2 border rounded flex-1">Annulla</button>
        <button id="confermaUscita" class="px-4 py-2 bg-red-500 text-white rounded flex-1">Conferma Uscita</button>
      </div>
    `;
    
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    
    const close = () => wrap.remove();
    $('#cancelUscita').addEventListener('click', close);
    
    $('#confermaUscita').addEventListener('click', async () => {
      try {
        await api('post', '/api/presenze/uscita');
        notify('Uscita registrata', 'success');
        close();
        aggiornaStatoPresenza();
      } catch (err) {
        console.error('Errore uscita:', err);
        notify('Errore uscita', 'error');
      }
    });
  }
  
  async function aggiornaStatoPresenza() {
    if (!state.user) return;
    
    try {
      const { presenza } = await api('get', '/api/presenze/oggi');
      const badgeEl = $('#badgePresenza');
      const btnUscitaEl = $('#btnUscita');
      
      if (!presenza || !presenza.ora_entrata) {
        if (badgeEl) badgeEl.innerHTML = '';
        if (btnUscitaEl) btnUscitaEl.remove();
        return;
      }
      
      const entrata = new Date(`2000-01-01T${presenza.ora_entrata}`);
      const ora = presenza.ora_uscita ? new Date(`2000-01-01T${presenza.ora_uscita}`) : new Date();
      const ore = Math.floor((ora - entrata) / 1000 / 60 / 60);
      const minuti = Math.floor(((ora - entrata) / 1000 / 60) % 60);
      
      if (badgeEl && !presenza.ora_uscita) {
        badgeEl.innerHTML = `
          <span class="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm">
            🟢 IN SERVIZIO - ${ore}h ${minuti}m
          </span>
        `;
      } else if (badgeEl) {
        badgeEl.innerHTML = '';
      }
      
      // Aggiungi pulsante uscita se non presente
      if (!presenza.ora_uscita && !btnUscitaEl) {
        const header = $('.header-actions');
        if (header) {
          const btn = el('button', {
            id: 'btnUscita',
            class: 'px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm'
          });
          btn.innerHTML = '<i class="fas fa-sign-out-alt mr-1"></i>Timbra Uscita';
          btn.addEventListener('click', mostraTimbraturaUscita);
          header.appendChild(btn);
        }
      } else if (presenza.ora_uscita && btnUscitaEl) {
        btnUscitaEl.remove();
      }
    } catch (err) {
      console.error('Errore aggiornamento stato presenza:', err);
    }
  }

/* ==================== RECALL SECTION ==================== */

async function renderRecalls() {
  const main = $('#main');
  
  main.innerHTML = `
    <div class="bg-white rounded-lg shadow-md p-6">
      <div class="flex justify-between items-center mb-6">
        <div>
          <h2 class="text-2xl font-bold text-gray-800">
            <i class="fas fa-phone-volume mr-2"></i>Recall Sandra
          </h2>
          <p class="text-gray-600 text-sm mt-1">Appuntamenti da richiamare (esito: non venduto)</p>
        </div>
        <button id="refreshRecall" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition">
          <i class="fas fa-sync-alt mr-2"></i>Aggiorna
        </button>
      </div>

      <!-- Filtri -->
      <div class="mb-4 grid md:grid-cols-4 gap-3">
        <input type="text" id="recallSearch" placeholder="Cerca cliente, telefono..." 
               class="p-2 border rounded w-full">
        <select id="recallStatoFilter" class="p-2 border rounded">
          <option value="">-- Tutti gli stati --</option>
          <option value="da_richiamare">📞 Da Richiamare</option>
          <option value="primo_contatto">📱 Primo Contatto</option>
          <option value="non_interessato">❌ Non Interessato</option>
          <option value="venduto">✅ Venduto</option>
        </select>
        <select id="recallProvincia" class="p-2 border rounded">
          <option value="">-- Tutte le province --</option>
        </select>
        <select id="recallVenditore" class="p-2 border rounded">
          <option value="">-- Tutti i venditori --</option>
        </select>
      </div>

      <!-- Lista recall -->
      <div id="recallList" class="space-y-3">
        <div class="text-center py-8 text-gray-500">
          <i class="fas fa-spinner fa-spin text-2xl mb-2"></i>
          <p>Caricamento...</p>
        </div>
      </div>
    </div>
  `;

  // Load appointments
  await loadRecallAppointments();

  // Event listeners
  $('#refreshRecall').addEventListener('click', loadRecallAppointments);
  $('#recallSearch').addEventListener('input', applyRecallFilters);
  $('#recallStatoFilter').addEventListener('change', applyRecallFilters);
  $('#recallProvincia').addEventListener('change', applyRecallFilters);
  $('#recallVenditore').addEventListener('change', applyRecallFilters);
}

let recallAppointmentsAll = [];
let recallAppointments = [];

async function loadRecallAppointments() {
  try {
    const { recalls } = await api('get', '/api/recalls');
    
    recallAppointmentsAll = recalls || [];
    
    console.log('📞 [RECALL] Appuntamenti non venduti:', recallAppointmentsAll.length);
    
    // Popola filtri provincia
    const province = [...new Set(recallAppointmentsAll.map(a => a.provincia).filter(Boolean))].sort();
    const provinciaSelect = $('#recallProvincia');
    provinciaSelect.innerHTML = '<option value="">-- Tutte le province --</option>' +
      province.map(p => `<option value="${p}">${p}</option>`).join('');
    
    // Popola filtri venditore
    const venditori = [...new Set(recallAppointmentsAll.map(a => a.venditore).filter(Boolean))].sort();
    const venditoreSelect = $('#recallVenditore');
    venditoreSelect.innerHTML = '<option value="">-- Tutti i venditori --</option>' +
      venditori.map(v => `<option value="${v}">${v}</option>`).join('');
    
    applyRecallFilters();
  } catch (e) {
    console.error('Errore caricamento recall:', e);
    $('#recallList').innerHTML = `
      <div class="text-center py-8 text-red-500">
        <i class="fas fa-exclamation-triangle text-2xl mb-2"></i>
        <p>Errore nel caricamento dei recall</p>
      </div>
    `;
  }
}

function applyRecallFilters() {
  const q = ($('#recallSearch')?.value || '').toLowerCase().trim();
  const statoRecall = ($('#recallStatoFilter')?.value || '').trim();
  const provincia = ($('#recallProvincia')?.value || '').trim();
  const venditore = ($('#recallVenditore')?.value || '').trim();
  
  let arr = recallAppointmentsAll.slice();
  
  // Filtro stato recall
  if (statoRecall) {
    arr = arr.filter(a => a.stato_recall === statoRecall);
  }
  
  // Filtro ricerca
  if (q) {
    arr = arr.filter(a => {
      const text = [
        a.cliente || '',
        a.customer_telefono || '',
        a.titolo || '',
        a.descrizione || ''
      ].join(' ').toLowerCase();
      return text.includes(q);
    });
  }
  
  // Filtro provincia
  if (provincia) {
    arr = arr.filter(a => a.provincia === provincia);
  }
  
  // Filtro venditore
  if (venditore) {
    arr = arr.filter(a => a.venditore === venditore);
  }
  
  // Ordina per data appuntamento (più recenti prima)
  arr.sort((a, b) => {
    const da = new Date(a.data_ora).valueOf() || 0;
    const db = new Date(b.data_ora).valueOf() || 0;
    return db - da; // DESC
  });
  
  recallAppointments = arr;
  renderRecallList();
}

function getStatoRecallBadge(stato) {
  const stati = {
    'da_richiamare': '<span class="px-2 py-1 bg-orange-100 text-orange-800 rounded text-xs">📞 Da Richiamare</span>',
    'primo_contatto': '<span class="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">📱 Primo Contatto</span>',
    'non_interessato': '<span class="px-2 py-1 bg-red-100 text-red-800 rounded text-xs">❌ Non Interessato</span>',
    'venduto': '<span class="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">✅ Venduto</span>'
  };
  return stati[stato] || '<span class="px-2 py-1 bg-gray-100 text-gray-800 rounded text-xs">🔄 Nuovo</span>';
}


function renderRecallList() {
  const list = $('#recallList');
  
  if (recallAppointments.length === 0) {
    list.innerHTML = `
      <div class="text-center py-8 text-gray-500">
        <i class="fas fa-check-circle text-4xl mb-2 text-green-500"></i>
        <p class="text-lg font-semibold">Nessun appuntamento da richiamare</p>
        <p class="text-sm">Ottimo lavoro! 🎉</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = `
    <div class="mb-3 text-sm text-gray-600">
      <i class="fas fa-info-circle mr-1"></i>
      Trovati <strong>${recallAppointments.length}</strong> appuntamenti da richiamare
    </div>
    ${recallAppointments.map(r => {
      const cliente = r.cliente || 'N/D';
      const telefono = r.customer_telefono || 'N/D';
      const provincia = r.provincia || '';
      const venditore = r.venditore || 'N/D';
      const dataAppt = r.data_ora ? new Date(r.data_ora).toLocaleDateString('it-IT') : 'N/D';
      const titolo = r.titolo || 'Appuntamento non venduto';
      const note = r.descrizione || r.customer_note || '';
      const indirizzo = r.customer_indirizzo || '';
      
      // Calcola giorni dall'appuntamento
      const oggi = new Date();
      const dataAppuntamento = new Date(r.data_ora);
      const giorniPassati = Math.ceil((oggi - dataAppuntamento) / (1000 * 60 * 60 * 24));
      const urgenzaText = giorniPassati === 0 ? 'Oggi' : 
                          giorniPassati === 1 ? 'Ieri' : 
                          `${giorniPassati} giorni fa`;
      const urgenzaClass = giorniPassati > 7 ? 'bg-red-500' : 
                           giorniPassati > 3 ? 'bg-orange-500' : 
                           'bg-yellow-500';
      
      return `
         <div class="bg-white rounded-lg shadow p-4 hover:shadow-lg transition cursor-pointer" data-appt-id="${r.id}">
        <div class="space-y-2">
          <div class="flex justify-between items-start">
            <div><strong>Cliente:</strong> ${cliente}</div>
            <div class="text-xs ${urgenzaClass} px-2 py-1 rounded text-white">${urgenzaText}</div>
          </div>
          <div><strong>Telefono:</strong> <a href="tel:${telefono}" class="text-blue-600 hover:underline" onclick="event.stopPropagation()">${telefono}</a></div>
          ${r.customer_email ? `<div><strong>Email:</strong> ${r.customer_email}</div>` : ''}
          ${indirizzo ? `<div><strong>Indirizzo:</strong> ${indirizzo}</div>` : ''}
          ${provincia ? `<div><strong>Provincia:</strong> ${provincia}</div>` : ''}
          <div><strong>Appuntamento:</strong> ${dataAppt}</div>
          <div><strong>Titolo:</strong> ${titolo}</div>
          <div><strong>Venditore:</strong> ${venditore}</div>
          <div><strong>Stato Recall:</strong> ${getStatoRecallBadge(r.stato_recall)}</div>
          ${r.note_recall ? `<div class="text-gray-700 mt-2 p-2 bg-blue-50 rounded border-l-4 border-blue-500"><strong>📝 Note Recall:</strong><br>${r.note_recall}</div>` : ''}
          ${r.customer_note ? `<div class="text-gray-700 mt-2 p-2 bg-yellow-50 rounded border-l-4 border-yellow-500"><strong>📋 Note Cliente:</strong><br>${r.customer_note}</div>` : ''}
          ${r.descrizione ? `<div class="text-gray-700 mt-2 p-2 bg-gray-50 rounded"><strong>📄 Note Appuntamento:</strong><br>${r.descrizione}</div>` : ''}
        </div>
          
          <div class="mt-4 flex gap-2 flex-wrap">
            <button class="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 transition text-sm" onclick="event.stopPropagation(); window.open('tel:${telefono}')">
              <i class="fas fa-phone mr-1"></i>Chiama
            </button>
            <button class="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition text-sm" data-edit-appt="${r.id}" onclick="event.stopPropagation()">
              <i class="fas fa-edit mr-1"></i>Modifica
            </button>
            <button class="px-3 py-1 bg-purple-500 text-white rounded hover:bg-purple-600 transition text-sm" data-files="${r.id}" onclick="event.stopPropagation()">
              <i class="fas fa-paperclip mr-1"></i>Allegati
            </button>
            <button class="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 transition text-sm" data-mark-sold="${r.id}" onclick="event.stopPropagation()">
              <i class="fas fa-check mr-1"></i>Segna Venduto
            </button>
          </div>
        </div>
      `;
    }).join('')}
  `;
  
    // Event listeners

  $$('[data-appt-id]', list).forEach(card => {
    card.addEventListener('click', async (e) => {
      if (e.target.closest('button')) return;
      const apptId = card.dataset.apptId;
      const appt = recallAppointments.find(a => String(a.id) === String(apptId));
      if (appt) openRecallStatusModal(appt);
    });
  });
  
  $$('button[data-edit-appt]', list).forEach(btn => {
    btn.addEventListener('click', async () => {
      const apptId = btn.dataset.editAppt;
      const appt = recallAppointments.find(r => String(r.id) === String(apptId));
      if (appt) openAppointmentModal(appt);
    });
  });
  
  $$('button[data-files]', list).forEach(btn => {
    btn.addEventListener('click', () => {
      openFilesModal(btn.dataset.files, 'appointment');
    });
  });
  
  $$('button[data-mark-sold]', list).forEach(btn => {
    btn.addEventListener('click', async () => {
      const apptId = btn.dataset.markSold;
      if (await confirmBox('Segnare questo appuntamento come VENDUTO?')) {
        try {
          await api('put', `/api/appointments/${apptId}`, { esito_vendita: 'venduto' });
          notify('Appuntamento segnato come venduto! ✅', 'success');
          loadRecallAppointments();
        } catch (e) {
          console.error('Errore:', e);
          notify('Errore durante l\'aggiornamento', 'error');
        }
      }
    });
  });
}
function openRecallStatusModal(recall) {
  const wrap = el('div', { class: 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50' });
  const card = el('div', { class: 'bg-white p-6 rounded-lg w-full max-w-md shadow-xl' });
  
  card.innerHTML = `
    <div class="flex justify-between items-center mb-4">
      <h3 class="text-lg font-semibold">
        <i class="fas fa-phone-volume mr-2"></i>Aggiorna Recall
      </h3>
      <button id="closeModal" class="text-gray-500 hover:text-gray-700">
        <i class="fas fa-times"></i>
      </button>
    </div>

    <div class="mb-4">
      <div class="text-sm text-gray-600 mb-2">Cliente: <strong>${recall.cliente}</strong></div>
      <div class="text-sm text-gray-600 mb-2">Telefono: <strong>${recall.customer_telefono}</strong></div>
    </div>

    <div class="mb-4">
      <label class="block text-sm font-medium mb-2">Stato Recall</label>
      <select id="statoRecallSelect" class="p-2 border rounded w-full">
        <option value="da_richiamare" ${recall.stato_recall === 'da_richiamare' ? 'selected' : ''}>📞 Da Richiamare</option>
        <option value="primo_contatto" ${recall.stato_recall === 'primo_contatto' ? 'selected' : ''}>📱 Primo Contatto</option>
        <option value="non_interessato" ${recall.stato_recall === 'non_interessato' ? 'selected' : ''}>❌ Non Interessato</option>
        <option value="venduto" ${recall.stato_recall === 'venduto' ? 'selected' : ''}>✅ Venduto</option>
      </select>
    </div>

    <div class="mb-4">
      <label class="block text-sm font-medium mb-2">Note Recall</label>
      <textarea id="noteRecallText" rows="4" class="p-2 border rounded w-full" placeholder="Inserisci note sul contatto...">${recall.note_recall || ''}</textarea>
    </div>

    <div class="flex justify-end gap-2">
      <button id="cancelBtn" class="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 transition">
        Annulla
      </button>
      <button id="saveBtn" class="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition">
        <i class="fas fa-save mr-2"></i>Salva
      </button>
    </div>
  `;

  wrap.appendChild(card);
  document.body.appendChild(wrap);

  $('#closeModal', card).addEventListener('click', () => wrap.remove());
  $('#cancelBtn', card).addEventListener('click', () => wrap.remove());

  $('#saveBtn', card).addEventListener('click', async () => {
    const statoRecall = $('#statoRecallSelect', card).value;
    const noteRecall = $('#noteRecallText', card).value.trim();

    const body = {
      stato_recall: statoRecall,
      note_recall: noteRecall
    };

    if (statoRecall === 'venduto') {
      body.esito_vendita = 'venduto';
    }

    try {
      await api('patch', `/api/recalls/${recall.id}`, body);
      notify('Recall aggiornato con successo! ✅', 'success');
      wrap.remove();
      loadRecallAppointments();
    } catch (e) {
      console.error('Errore aggiornamento recall:', e);
      notify('Errore durante l\'aggiornamento', 'error');
    }
  });
}
})();
