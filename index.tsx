 import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

// 🔧 TypeScript bindings per Cloudflare
type Bindings = {
  DB: D1Database;
  R2: R2Bucket;
}

const app = new Hono<{ Bindings: Bindings }>()
let __DB_READY = false;
async function ensureInit(db: D1Database) {
  if (!__DB_READY) {
    await initializeDatabase(db);
    __DB_READY = true;
  }
}

/* ---------------- CORS ---------------- */
app.use('/api/*', cors({
  origin: '*',
  allowHeaders: ['Content-Type', 'Authorization', 'user-id', 'user-role'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
}))

app.use('/api/*', async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})

/* ------------- STATIC FILES ------------- */
app.use('/static/*', serveStatic({ root: './public' }))

/* ------------- DB HELPERS ------------- */
async function addColumnIfMissing(db: D1Database, table: string, column: string, def: string) {
  const cols = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  const exists = (cols.results || []).some((r: any) => r.name === column)
  if (!exists) {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`).run()
    console.log(`[MIGRATION] added column ${table}.${column}`)
  }
}

async function columnExists(db: D1Database, table: string, column: string) {
  const info = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  return (info.results || []).some((c: any) => c.name === column)
}

async function hasScope(db: D1Database, userId: number, scope: string) {
  const row = await db.prepare(`SELECT scopes FROM users WHERE id = ?`).bind(userId).first<{ scopes: string }>()
  if (!row?.scopes) return false
  try {
    const arr = JSON.parse(row.scopes)
    return Array.isArray(arr) && arr.includes(scope)
  } catch {
    return false
  }
}

/* -------- Helpers utente interno (Sandra) -------- */
const SANDRA_USERNAME = 'sandra';

async function getUserIdByUsername(db: D1Database, username: string): Promise<number | null> {
  const row = await db.prepare(`SELECT id FROM users WHERE username = ? AND attivo = 1`)
    .bind(username)
    .first<{ id: number }>();
  return row?.id ?? null;
}

/* -------- Helpers date -------- */
function toYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

/** Converte Date in formato SQLite locale 'YYYY-MM-DD HH:MM:SS' */
function toSqliteLocalDateTime(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

/** Accetta 'YYYY-MM-DD', 'DD/MM/YYYY', ISO, ecc. -> ritorna 'YYYY-MM-DD' (locale) */
function normalizeDateOnly(input?: string | null): string | null {
  if (!input) return null;

  // già nel formato giusto
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;

  // formato italiano DD/MM/YYYY
  const it = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input);
  if (it) {
    const [_, dd, mm, yyyy] = it;
    return `${yyyy}-${mm}-${dd}`;
  }

  // ISO o qualsiasi cosa parseabile da Date
  const dt = new Date(input);
  if (!isNaN(dt.getTime())) {
    // usa la data **locale** (niente UTC)
    return toYMD(new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()));
  }

  return null;
}



async function deleteCustomerDeep(db: D1Database, customerId: number | string) {
  await db.prepare(`DELETE FROM preventivi_notifiche WHERE preventivo_id IN (SELECT id FROM preventivi WHERE customer_id = ?)`).bind(customerId).run()
  await db.prepare(`DELETE FROM preventivi WHERE customer_id = ?`).bind(customerId).run()
  await db.prepare(`DELETE FROM promemoria WHERE customer_id = ?`).bind(customerId).run()
  await db.prepare(`DELETE FROM attachments WHERE customer_id = ?`).bind(customerId).run()
  await db.prepare(`DELETE FROM attachments WHERE appointment_id IN (SELECT id FROM appointments WHERE customer_id = ?)`).bind(customerId).run()
  await db.prepare(`DELETE FROM montaggi WHERE order_id IN (SELECT id FROM orders WHERE customer_id = ?)`).bind(customerId).run()
  await db.prepare(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE customer_id = ?)`).bind(customerId).run()
  await db.prepare(`DELETE FROM orders WHERE customer_id = ?`).bind(customerId).run()
  await db.prepare(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE customer_id = ?)`).bind(customerId).run()
  await db.prepare(`DELETE FROM sales WHERE customer_id = ?`).bind(customerId).run()
  await db.prepare(`DELETE FROM appointments WHERE customer_id = ?`).bind(customerId).run()
  await db.prepare(`DELETE FROM activities WHERE customer_id = ?`).bind(customerId).run()
  await db.prepare(`DELETE FROM customers WHERE id = ?`).bind(customerId).run()
}

async function deleteAppointmentDeep(db: D1Database, appointmentId: number | string) {
  await db.prepare(`DELETE FROM attachments WHERE appointment_id = ?`).bind(appointmentId).run()
  await db.prepare(`DELETE FROM montaggi WHERE order_id IN (SELECT id FROM orders WHERE sale_id IN (SELECT id FROM sales WHERE appointment_id = ?))`).bind(appointmentId).run()
  await db.prepare(`DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE sale_id IN (SELECT id FROM sales WHERE appointment_id = ?))`).bind(appointmentId).run()
  await db.prepare(`DELETE FROM orders WHERE sale_id IN (SELECT id FROM sales WHERE appointment_id = ?)`).bind(appointmentId).run()
  await db.prepare(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE appointment_id = ?)`).bind(appointmentId).run()
  await db.prepare(`DELETE FROM sales WHERE appointment_id = ?`).bind(appointmentId).run()
  await db.prepare(`DELETE FROM appointments WHERE id = ?`).bind(appointmentId).run()
}

async function createPreventivoNotifica(db: D1Database, preventivoId: number, userId: number, tipo: string) {
  await db.prepare(`
    INSERT INTO preventivi_notifiche (preventivo_id, user_id, tipo, letto)
    VALUES (?, ?, ?, 0)
  `).bind(preventivoId, userId, tipo).run()
}

async function deletePreventivo(db: D1Database, preventivoId: number | string) {
  await db.prepare(`DELETE FROM preventivi_notifiche WHERE preventivo_id = ?`).bind(preventivoId).run()
  await db.prepare(`DELETE FROM attachments WHERE preventivo_id = ?`).bind(preventivoId).run()
  await db.prepare(`DELETE FROM preventivi WHERE id = ?`).bind(preventivoId).run()
}

async function initializeDatabase(db: D1Database) {
  await db.prepare('PRAGMA foreign_keys = ON').run()

  /* USERS */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','venditore')),
      nome_completo TEXT NOT NULL,
      email TEXT,
      telefono TEXT,
      attivo INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run()

await addColumnIfMissing(db, 'users', 'scopes', 'TEXT'); // JSON con permessi
await addColumnIfMissing(db, 'users', 'pc_fingerprint', 'TEXT'); // Device lock
await addColumnIfMissing(db, 'users', 'ultimo_accesso', 'DATETIME'); // Tracking inattività



  /* CUSTOMERS */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      cognome TEXT NOT NULL,
      email TEXT,
      telefono TEXT,
      azienda TEXT,
      indirizzo TEXT,
      citta TEXT,
      cap TEXT,
      provincia TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run()

  await addColumnIfMissing(db, 'customers', 'assegnato_a', 'INTEGER')
  await addColumnIfMissing(db, 'customers', 'stato', "TEXT DEFAULT 'nuovo'")
  await addColumnIfMissing(db, 'customers', 'data_richiamo', 'DATE')
  await addColumnIfMissing(db, 'customers', 'venditore_originale', 'INTEGER')
  await addColumnIfMissing(db, 'customers', 'codice_fiscale', 'TEXT')
  await addColumnIfMissing(db, 'customers', 'partita_iva', 'TEXT')
  await addColumnIfMissing(db, 'customers', 'codice_sdi', 'TEXT')

// Campi cantiere diverso
await addColumnIfMissing(db, 'customers', 'cantiere_diverso', 'INTEGER DEFAULT 0')
await addColumnIfMissing(db, 'customers', 'cantiere_indirizzo', 'TEXT')
await addColumnIfMissing(db, 'customers', 'cantiere_citta', 'TEXT')
await addColumnIfMissing(db, 'customers', 'cantiere_cap', 'TEXT')
await addColumnIfMissing(db, 'customers', 'cantiere_provincia', 'TEXT')
  // Campi contratto firmato
  await addColumnIfMissing(db, 'customers', 'numero_contratto', 'TEXT')
  await addColumnIfMissing(db, 'customers', 'data_firma_contratto', 'DATE')
  await addColumnIfMissing(db, 'customers', 'venditore_firma', 'TEXT')
  await addColumnIfMissing(db, 'customers', 'importo_contratto', 'DECIMAL(10,2)')
  await addColumnIfMissing(db, 'customers', 'prodotti_venduti', 'TEXT')
  


  /* PRODUCTS */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codice TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      descrizione TEXT,
      categoria TEXT,
      prezzo_base DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      prezzo_vendita DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      disponibile INTEGER DEFAULT 1,
      giacenza INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run()

  // Aggiungi colonne fornitore e quantità ai prodotti
 await addColumnIfMissing(db, 'products', 'fornitore', 'TEXT')
await addColumnIfMissing(db, 'products', 'quantita', 'INTEGER DEFAULT 1')

  /* SALES */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero_ordine TEXT UNIQUE NOT NULL,
      customer_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      data_vendita DATE NOT NULL,
      totale DECIMAL(10,2) NOT NULL DEFAULT 0.00,
      stato TEXT NOT NULL DEFAULT 'confermata',
      note TEXT,
      appointment_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run()

  await addColumnIfMissing(db, 'sales', 'appointment_id', 'INTEGER')
  await addColumnIfMissing(db, 'sales', 'numero_contratto', 'TEXT')

  /* SALE ITEMS */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER,
      product_id INTEGER,
      quantita INTEGER NOT NULL DEFAULT 1,
      prezzo_unitario DECIMAL(10,2) NOT NULL,
      subtotale DECIMAL(10,2) NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `).run()

  /* ACTIVITIES */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL,
      descrizione TEXT NOT NULL,
      customer_id INTEGER,
      user_id INTEGER NOT NULL,
      data_attivita DATETIME DEFAULT CURRENT_TIMESTAMP,
      metadata TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run()

  /* APPOINTMENTS */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      titolo TEXT NOT NULL,
      descrizione TEXT,
      data_ora DATETIME NOT NULL,
      durata_min INTEGER DEFAULT 60,
      stato TEXT DEFAULT 'programmato',
      interno INTEGER DEFAULT 1,
      contratto_chiuso INTEGER DEFAULT 0,
      importo DECIMAL(20,2) DEFAULT 0.00,
      prodotti_venduti TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run()

  await addColumnIfMissing(db, 'appointments', 'prodotti_venduti', 'TEXT')
  await addColumnIfMissing(db, 'appointments', 'esito_vendita', 'TEXT')  // 'venduto', 'non_venduto', null
  await addColumnIfMissing(db, 'appointments', 'stato_recall', 'TEXT') // 'primo_contatto', 'non_interessato', 'venduto', 'da_richiamare'
  await addColumnIfMissing(db, 'appointments', 'note_recall', 'TEXT')
  
  /* ATTACHMENTS */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      appointment_id INTEGER,
      preventivo_id INTEGER,
      tipo_allegato TEXT DEFAULT 'generico',
      filename TEXT NOT NULL,
      mime_type TEXT,
      size INTEGER,
      data_base64 TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (appointment_id) REFERENCES appointments(id),
      FOREIGN KEY (preventivo_id) REFERENCES preventivi(id)
    )
  `).run()

  await addColumnIfMissing(db, 'attachments', 'preventivo_id', 'INTEGER')
  await addColumnIfMissing(db, 'attachments', 'tipo_allegato', "TEXT DEFAULT 'generico'")

  /* ORDERS */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      user_id INTEGER,
      stato TEXT NOT NULL DEFAULT 'in_preparazione',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run()

  await addColumnIfMissing(db, 'orders', 'user_id', 'INTEGER')

  /* ORDER ITEMS */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_type TEXT NOT NULL,
      selezionato INTEGER DEFAULT 0,
      costo DECIMAL(20,2) DEFAULT 0.00,
      data_prevista DATE,
      data_arrivo DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `).run()

  await addColumnIfMissing(db, 'order_items', 'selezionato', 'INTEGER DEFAULT 0')
  await addColumnIfMissing(db, 'order_items', 'product_type', "TEXT DEFAULT 'infissi'")
  await addColumnIfMissing(db, 'order_items', 'fornitore', 'TEXT')
  await addColumnIfMissing(db, 'order_items', 'quantita', 'INTEGER DEFAULT 1')
  await addColumnIfMissing(db, 'order_items', 'costo', 'DECIMAL(20,2) DEFAULT 0.00')
  await addColumnIfMissing(db, 'order_items', 'data_prevista', 'DATE')
  await addColumnIfMissing(db, 'order_items', 'data_arrivo', 'DATE')

  /* MONTAGGI */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS montaggi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      product_type TEXT NOT NULL,
      data_montaggio DATE,
      ora_montaggio TIME,
      montatori TEXT,
      stato TEXT DEFAULT 'da_programmare',
      note TEXT,
      priorita TEXT DEFAULT 'normale',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `).run()
await addColumnIfMissing(db, 'montaggi', 'da_ritornare', 'INTEGER DEFAULT 0')
await addColumnIfMissing(db, 'montaggi', 'manutenzioni', 'INTEGER DEFAULT 0')

// 🔧 Rendi order_id nullable per permettere montaggi senza ordine (es. rilievi)
try {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS montaggi_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      customer_id INTEGER NOT NULL,
      product_type TEXT NOT NULL,
      data_montaggio DATE,
      ora_montaggio TIME,
      montatori TEXT,
      stato TEXT DEFAULT 'da_programmare',
      note TEXT,
      priorita TEXT DEFAULT 'normale',
      da_ritornare INTEGER DEFAULT 0,
      manutenzioni INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )
  `).run()
  
  // Copia i dati esistenti
  await db.prepare(`
    INSERT INTO montaggi_new SELECT * FROM montaggi
  `).run()
  
  // Elimina la vecchia tabella
  await db.prepare(`DROP TABLE montaggi`).run()
  
  // Rinomina la nuova tabella
  await db.prepare(`ALTER TABLE montaggi_new RENAME TO montaggi`).run()
  
  console.log('✅ Tabella montaggi aggiornata: order_id ora nullable')
} catch (e) {
  console.log('ℹ️ Tabella montaggi già aggiornata o errore:', e)
}
 
 /* PRATICHE ENEA */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS pratiche_enea (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      montaggio_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      data_completamento_montaggio DATE NOT NULL,
      stato TEXT DEFAULT 'da_fare',
      note TEXT,
      data_completamento DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      archiviato INTEGER DEFAULT 0,
      FOREIGN KEY (montaggio_id) REFERENCES montaggi(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (order_id) REFERENCES orders(id)
    )
  `).run()

  await db.prepare(` 
CREATE INDEX IF NOT EXISTS idx_pratiche_enea_stato 
    ON pratiche_enea(stato)
  `).run()

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_pratiche_enea_customer 
    ON pratiche_enea(customer_id)
  `).run()

/* PREVENTIVI */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS preventivi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      richiedente_id INTEGER NOT NULL,
      stato TEXT NOT NULL DEFAULT 'in_attesa',
      priorita TEXT DEFAULT 'entro_96h' CHECK (priorita IN ('in_giornata', 'entro_48h', 'entro_72h', 'entro_96h')),
      note_richiesta TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (richiedente_id) REFERENCES users(id)
    )
  `).run()

  // Aggiungi colonna priorita se mancante (per database esistenti)
  await addColumnIfMissing(db, 'preventivi', 'priorita', "TEXT DEFAULT 'entro_96h' CHECK (priorita IN ('in_giornata', 'entro_48h', 'entro_72h', 'entro_96h'))")
  await addColumnIfMissing(db, 'preventivi', 'citta', 'TEXT')
  await addColumnIfMissing(db, 'preventivi', 'provincia', 'TEXT')
  await addColumnIfMissing(db, 'preventivi', 'note_preventivista', 'TEXT')
  await addColumnIfMissing(db, 'preventivi', 'assegnato_a', 'INTEGER')  // Chi ha preso in carico
 
 /* PREVENTIVI NOTIFICHE */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS preventivi_notifiche (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      preventivo_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      letto INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (preventivo_id) REFERENCES preventivi(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run()
   
   /* PROMEMORIA - Tabella necessaria per inizializzazione DB */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS promemoria (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      data_promemoria DATE NOT NULL,
      motivo TEXT,
      note TEXT,
      stato TEXT DEFAULT 'attivo',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `).run()
   
  /* INDEXES */
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_customers_assegnato ON customers(assegnato_a)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_customers_stato ON customers(stato)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_customers_richiamo ON customers(data_richiamo)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_sales_user_id ON sales(user_id)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_orders_sale ON orders(sale_id)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_appt_user ON appointments(user_id)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_appt_datetime ON appointments(data_ora)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_montaggi_data ON montaggi(data_montaggio)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_montaggi_stato ON montaggi(stato)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_promemoria_data ON promemoria(data_promemoria)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_promemoria_user ON promemoria(user_id)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(data_attivita)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_appt_customer ON appointments(customer_id)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_preventivi_richiedente ON preventivi(richiedente_id)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_preventivi_stato ON preventivi(stato)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_preventivi_customer ON preventivi(customer_id)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_preventivi_notifiche_user ON preventivi_notifiche(user_id)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_preventivi_created_id ON preventivi(created_at, id)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_preventivi_stato_created ON preventivi(stato, created_at)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_attachments_preventivo_tipo ON attachments(preventivo_id, tipo_allegato)').run()


 /* RILIEVI */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS rilievi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      stato TEXT NOT NULL DEFAULT 'da programmare',
      data_rilievo DATE,
      ora_rilievo TIME,
      tecnico_id INTEGER,
      note TEXT,
	  tempo_stimato_montaggio TEXT,
      allegato BLOB,
      allegato_nome TEXT,
      allegato_tipo TEXT,
      data_completamento DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY (tecnico_id) REFERENCES users(id)
    )
  `).run()

  /* INDEXES RILIEVI */
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_rilievi_customer ON rilievi(customer_id)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_rilievi_stato ON rilievi(stato)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_rilievi_data ON rilievi(data_rilievo)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_rilievi_tecnico ON rilievi(tecnico_id)').run()
  await addColumnIfMissing(db, 'rilievi', 'tempo_stimato_montaggio', 'TEXT')
  await addColumnIfMissing(db, 'rilievi', 'prodotti_quantita', 'TEXT')  
  
  /* RILIEVO DETTAGLI */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS rilievo_dettagli (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rilievo_id INTEGER NOT NULL UNIQUE,
      anagrafica_json TEXT,
      finestre_json TEXT,
      elementi_tecnici_json TEXT,
      commenti TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rilievo_id) REFERENCES rilievi(id) ON DELETE CASCADE
    )
  `).run()
  
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_rilievo_dettagli_rilievo ON rilievo_dettagli(rilievo_id)').run()
  /* PRESENZE */
  
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS presenze (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      data DATE NOT NULL,
      ora_entrata TIME,
      ora_uscita TIME,
      pausa_pranzo INTEGER DEFAULT 0,
      tipo TEXT DEFAULT 'lavoro',
      note TEXT,
      pc_fingerprint TEXT,
      ip_address TEXT,
      confermata INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, data)
    )
  `).run()
  
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_presenze_user ON presenze(user_id)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_presenze_data ON presenze(data)').run()
  
  
  /* META CONVERSIONS */
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS meta_conversions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_name TEXT NOT NULL,
      event_time INTEGER NOT NULL,
      user_data TEXT,
      custom_data TEXT,
      event_id TEXT UNIQUE,
      customer_id INTEGER,
      sale_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    )
  `).run()

  /* INDEXES META */
  // await db.prepare('CREATE INDEX IF NOT EXISTS idx_meta_leads_status ON meta_leads(status)').run()
  // await db.prepare('CREATE INDEX IF NOT EXISTS idx_meta_leads_customer ON meta_leads(customer_id)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_meta_conversions_customer ON meta_conversions(customer_id)').run()
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_meta_conversions_sale ON meta_conversions(sale_id)').run()
  /* SEED USERS */
  await db.prepare(`
    INSERT OR IGNORE INTO users (username,password,role,nome_completo,email,telefono,attivo) VALUES
    ('admin','admin123','admin','Amministratore','admin@example.com','',1),
    ('narciso','narciso123','venditore','Narciso','narciso@example.com','',1),
 ('fabio','fabio123','venditore','Fabio','fabio@example.com','',1),
    ('max','max123','venditore','Max','max@example.com','',1)
  `).run()

/* Fabio e Max: venditori ESTERNI - accesso SOLO agenda */
await db.prepare(`
  UPDATE users
  SET scopes = '["agenda"]'
  WHERE username IN ('fabio','max')
`).run();


/* SEED utenti aggiuntivi (se mancanti) */
await db.prepare(`
  INSERT OR IGNORE INTO users (username,password,role,nome_completo,email,telefono,attivo)
  VALUES
    ('paola','paola123','admin','Paola','paola@example.com','',1),
    ('olga','StordY-26','venditore','Olga','olga@example.com','',1),
    ('giulia','aron17','venditore','Giulia','giulia@example.com','',1),
    ('giada','giada123','venditore','Giada','giada@example.com','',1)
`).run();

// 🔧 FORZA aggiornamento password (per utenti già esistenti)
await db.prepare(`
  UPDATE users SET password = 'aron17' WHERE username = 'giulia'
`).run();

await db.prepare(`
  UPDATE users SET password = 'StordY-26' WHERE username = 'olga'
`).run();

await db.prepare(`
  UPDATE users SET password = 'ciaociao97' WHERE username = 'stefano'
`).run();

await db.prepare(`
  UPDATE users SET password = 'A2006' WHERE username = 'alice'
`).run();

await db.prepare(`
  UPDATE users SET password = 'hogrider67unica' WHERE username = 'adam'
`).run();

await db.prepare(`
  INSERT OR IGNORE INTO users (username,password,role,nome_completo,email,telefono,attivo)
  VALUES ('sandra','sandra123','venditore','Sandra','sandra@example.com','',1)
`).run();

/* SEED Isam (gestore preventivi) - ruolo venditore con scope preventivi */
await db.prepare(`
  INSERT OR IGNORE INTO users (username,password,role,nome_completo,email,telefono,attivo)
  VALUES ('isam','isam123','venditore','Isam','isam@example.com','',1)
`).run();

/* Isam: accesso SOLO ai preventivi */
await db.prepare(`
  UPDATE users
  SET scopes = '["preventivi"]'
  WHERE username = 'isam'
`).run();

/* Sandra: gestisce SOLO appuntamenti interni (NO agenda_all) */
await db.prepare(`
  UPDATE users
  SET scopes = '["customers","agenda"]'
  WHERE username = 'sandra'
`).run();


/* Isam: accesso SOLO ai preventivi */
await db.prepare(`
  UPDATE users
  SET scopes = '["preventivi"]'
  WHERE username = 'isam'
`).run();

/* SEED Cosimo (gestore rilievi) */
await db.prepare(`
  INSERT OR IGNORE INTO users (username,password,role,nome_completo,email,telefono,attivo)
  VALUES ('cosimo','cosimo123','venditore','Cosimo','cosimo@example.com','',1)
`).run();

/* Cosimo: accesso SOLO ai rilievi */
await db.prepare(`
  UPDATE users
  SET scopes = '["rilievi"]'
  WHERE username = 'cosimo'
`).run();

/* Proprietario (admin) + Paola: tutto + fatturato + agenda completa */
await db.prepare(`
  UPDATE users
  SET scopes = '["customers","agenda","orders","montaggi","revenue","agenda_all"]'
  WHERE username IN ('admin','paola')
`).run();

/* SEED Stefano (admin) */
await db.prepare(`
  INSERT OR IGNORE INTO users (username,password,role,nome_completo,email,telefono,attivo)
  VALUES ('stefano','ciaociao97','admin','Stefano','stefano@example.com','',1)
`).run();

/* Stefano: stessi permessi di admin/Paola */
await db.prepare(`
  UPDATE users
  SET scopes = '["customers","agenda","orders","montaggi","revenue","agenda_all","presenze"]'
  WHERE username = 'stefano'
`).run();

/* SEED Alice (admin) */
await db.prepare(`
  INSERT OR IGNORE INTO users (username,password,role,nome_completo,email,telefono,attivo)
  VALUES ('alice','A2006','admin','Alice','alice@example.com','',1)
`).run();

/* Alice: stessi permessi di admin/Paola */
await db.prepare(`
  UPDATE users
  SET scopes = '["customers","agenda","orders","montaggi","revenue","agenda_all","presenze"]'
  WHERE username = 'alice'
`).run();

/* SEED Adam (venditore con permessi preventivi come Isam) */
await db.prepare(`
  INSERT OR IGNORE INTO users (username,password,role,nome_completo,email,telefono,attivo)
  VALUES ('adam','hogrider67unica','venditore','Adam','adam@example.com','',1)
`).run();

/* Adam: accesso SOLO ai preventivi (come Isam) */
await db.prepare(`
  UPDATE users
  SET scopes = '["preventivi"]'
  WHERE username = 'adam'
`).run();

/* Default per TUTTI i venditori: clienti + agenda propria */

/* Default per TUTTI i venditori: clienti + agenda propria */
await db.prepare(`
  UPDATE users
  SET scopes = COALESCE(scopes, '["customers","agenda"]')
  WHERE role = 'venditore'
`).run();

/* Giulia: clienti + agenda COMPLETA (non solo la propria) */
await db.prepare(`
  UPDATE users
  SET scopes = '["customers","agenda","agenda_all"]'
  WHERE username = 'giulia'
`).run();

/* Olga: clienti + agenda COMPLETA + ordini + montaggi + rilievi (stessi permessi di Giada + agenda_all) */
await db.prepare(`
  UPDATE users
  SET scopes = '["customers","agenda","agenda_all","orders","montaggi","rilievi"]'
  WHERE username = 'olga'
`).run();

/* Giada: clienti + ordini + montaggi + rilievi + preventivi + pratiche ENEA (no agenda_all, no revenue) */
await db.prepare(`
  UPDATE users
  SET scopes = '["customers","orders","montaggi","rilievi","preventivi","pratiche_enea"]'
  WHERE username = 'giada'
`).run();

/* Admin + Paola: scope presenze */
await db.prepare(`
  UPDATE users
  SET scopes = json_insert(COALESCE(scopes, '[]'), '$[#]', 'presenze')
  WHERE username IN ('admin', 'paola')
`).run();
}

function generateOrderNumber() {
  const n = new Date()
  return `ORD${n.getFullYear().toString().slice(-2)}${String(n.getMonth() + 1).padStart(2, '0')}${String(n.getDate()).padStart(2, '0')}${n.getTime().toString().slice(-6)}`
}

async function validateUser(db: D1Database, u: string, p: string) {
  try {
  const r = await db.prepare(`
  SELECT id, username, role, nome_completo, email, attivo, scopes
  FROM users 
  WHERE username = ? AND password = ? AND attivo = 1
`).bind(u, p).first()
    return r || null
  } catch {
    return null
  }
}

async function createOrderIfMissing(db: D1Database, saleId: number, customerId: number, prodottiVenduti?: string) {
  if (!saleId) return

  const ex = await db.prepare(`SELECT id FROM orders WHERE sale_id = ?`).bind(saleId).first()
  if (ex) return

  const sale = await db.prepare(`SELECT user_id FROM sales WHERE id = ?`).bind(saleId).first<{ user_id: number } | null>()
  const hasUserId = await columnExists(db, 'orders', 'user_id')

  let orderId: number
  if (hasUserId) {
    const result: any = await db.prepare(`
      INSERT INTO orders (sale_id, customer_id, user_id, stato) 
      VALUES (?, ?, ?, 'in_preparazione')
    `).bind(saleId, customerId, sale ? (sale as any).user_id : null).run()
    orderId = result.meta?.last_row_id
  } else {
    const result: any = await db.prepare(`
      INSERT INTO orders (sale_id, customer_id, stato) 
      VALUES (?, ?, 'in_preparazione')
    `).bind(saleId, customerId).run()
    orderId = result.meta?.last_row_id
  }

  if (orderId) {
    const productTypes = [
      'infissi', 'tapparelle', 'zanzariere', 'scuri',
'porta_blindata', 'porte_interne', 'veneziane', 'pergole', 'cassonetti'
    ]

    let prodottiSelezionati: string[] = []
    if (prodottiVenduti) {
      try {
        prodottiSelezionati = JSON.parse(prodottiVenduti)
      } catch {
        prodottiSelezionati = []
      }
    }

    for (const productType of productTypes) {
      const selezionato = prodottiSelezionati.includes(productType) ? 1 : 0
      await db.prepare(`
        INSERT INTO order_items (
          order_id, product_type, selezionato, costo, data_prevista, data_arrivo
        ) VALUES (?, ?, ?, 0.00, NULL, NULL)
      `).bind(orderId, productType, selezionato).run()
    }
    // 🔧 Crea montaggi automaticamente per i prodotti selezionati
    if (orderId && prodottiSelezionati.length > 0) {
      for (const productType of prodottiSelezionati) {
        await db.prepare(`
          INSERT INTO montaggi (
            order_id, customer_id, product_type, stato, priorita, created_at
          ) VALUES (?, ?, ?, 'da_programmare', 'normale', CURRENT_TIMESTAMP)
        `).bind(orderId, customerId, productType).run()
      }
    }
    }
  
  return orderId
}

async function seedOrderItemsIfMissing(db: D1Database, orderId: number): Promise<void> {
  try {
    // Controlla se esistono già items per questo ordine
    const existingItems = await db.prepare(`
      SELECT COUNT(*) as count FROM order_items WHERE order_id = ?
    `).bind(orderId).first<{ count: number }>()

    if (existingItems?.count && existingItems.count > 0) {
      return // Items già esistenti, non fare nulla
    }

    console.log(`[SEED] Creating missing order items for order ${orderId}`)

    // Lista dei tipi di prodotto standard
      const productTypes = [
      'infissi', 'tapparelle', 'zanzariere', 'scuri',
      'porta_blindata', 'porte_interne', 'veneziane', 'pergole', 'cassonetti'
    ]

    // Crea gli items mancanti
    for (const productType of productTypes) {
      await db.prepare(`
        INSERT INTO order_items (order_id, product_type, selezionato, costo, data_prevista, data_arrivo)
        VALUES (?, ?, 0, 0.00, NULL, NULL)
      `).bind(orderId, productType).run()
    }

    console.log(`[SEED] Created ${productTypes.length} order items for order ${orderId}`)
  } catch (error: any) {
    console.error(`[SEED ERROR] Error seeding order items for order ${orderId}:`, error.message)
  }
}

/* ---------------- META API HELPERS ---------------- */

/**
 * Chiama Meta Graph API
 */
async function callMetaAPI(
  endpoint: string,
  accessToken: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: any
): Promise<any> {
  const url = `https://graph.facebook.com/v21.0/${endpoint}`
  
  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    }
  }

  if (body && method !== 'GET') {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(url, options)
  const data = await response.json()

  if (!response.ok) {
    throw new Error(`Meta API Error: ${data.error?.message || 'Unknown error'}`)
  }

  return data
}

/**
 * Invia evento conversione a Meta
 */
async function sendMetaConversion(
  pixelId: string,
  conversionToken: string,
  eventName: string,
  eventData: {
    event_time: number
    user_data?: {
      em?: string[]      // email (hashed SHA256)
      ph?: string[]      // phone (hashed SHA256)
      fn?: string        // first name (hashed)
      ln?: string        // last name (hashed)
      ct?: string        // city
      st?: string        // state
      zp?: string        // zip
      country?: string
      client_ip_address?: string
      client_user_agent?: string
      fbp?: string       // Facebook browser ID (_fbp cookie)
      fbc?: string       // Facebook click ID (_fbc cookie)
    }
    custom_data?: {
      value?: number
      currency?: string
      content_name?: string
      content_type?: string
      contents?: any[]
    }
    event_id?: string
    action_source: 'website' | 'email' | 'phone_call' | 'physical_store'
  }
): Promise<any> {
  const url = `https://graph.facebook.com/v21.0/${pixelId}/events`
  
  const payload = {
    data: [eventData],
    access_token: conversionToken
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  const result = await response.json()

  if (!response.ok) {
    throw new Error(`Meta Conversions API Error: ${result.error?.message || 'Unknown error'}`)
  }

  return result
}

/**
 * Hash SHA256 per user_data (GDPR compliant)
 */
async function hashSHA256(input: string): Promise<string> {
  const normalized = input.toLowerCase().trim()
  const encoder = new TextEncoder()
  const data = encoder.encode(normalized)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

/* ---------------- ROOT HTML ---------------- */
app.get('/', (c) => c.html(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UNICA CRM System</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" rel="stylesheet">
  <link href="/static/style.css" rel="stylesheet">
</head>
<body class="bg-gray-100 font-sans">
  <div id="app" class="min-h-screen">
    <div id="loading" class="flex items-center justify-center min-h-screen">
      <div class="text-center">
        <div class="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-500 mx-auto"></div>
        <p class="mt-4 text-gray-600">Caricamento UNICA CRM System...</p>
      </div>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/dayjs@1.11.10/dayjs.min.js"></script>
  <script src="https://unpkg.com/read-excel-file@5.x/bundle/read-excel-file.min.js"></script>
  <script src="/static/app.js"></script>
</body>
</html>`))

/* ---------------- AUTH ---------------- */
app.post('/api/auth/login', async (c) => {
  try {
    const body = await c.req.json();
    const { username, password, pc_fingerprint } = body;
    
    if (!username || !password) {
      return c.json({ error: 'Username e password sono obbligatori' }, 400)
    }

    await ensureInit(c.env.DB)
    const user = await validateUser(c.env.DB, username, password)

    if (!user) {
      return c.json({ error: 'Credenziali non valide' }, 401)
    }

    // 🔧 CRITICAL FIX: Parse scopes da stringa JSON ad array
    const userData = { ...user } as any;
    if (userData.scopes && typeof userData.scopes === 'string') {
      try {
        userData.scopes = JSON.parse(userData.scopes);
      } catch (e) {
        console.error('❌ Errore parsing scopes:', e);
        userData.scopes = [];
      }
    } else if (!userData.scopes) {
      userData.scopes = [];
    }

   // Rimuovi password dalla risposta
    delete userData.password;

    console.log('✅ Login successful:', username, 'Role:', userData.role, 'Scopes:', userData.scopes);

    // 🔒 DEVICE LOCK: Verifica fingerprint (solo per non-admin)
    
    if (userData.role !== 'admin' && pc_fingerprint) {
      // Controlla se l'utente ha già un fingerprint registrato
      const existingFingerprint = await c.env.DB.prepare(`
        SELECT pc_fingerprint, ultimo_accesso 
        FROM users 
        WHERE id = ?
      `).bind(userData.id).first<{ pc_fingerprint: string | null, ultimo_accesso: string | null }>();

      if (existingFingerprint?.pc_fingerprint && existingFingerprint.pc_fingerprint !== pc_fingerprint) {
        // Fingerprint diverso → ACCESSO NEGATO
        return c.json({ 
          error: 'Accesso negato: questo account può essere usato solo dal dispositivo registrato. Contatta l\'amministratore.' 
        }, 403);
      }

      // Primo accesso o stesso dispositivo → salva/aggiorna fingerprint + ultimo_accesso
      await c.env.DB.prepare(`
        UPDATE users 
        SET pc_fingerprint = ?, ultimo_accesso = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).bind(pc_fingerprint, userData.id).run();
      
      userData.ultimo_accesso = new Date().toISOString();
    }

    await c.env.DB.prepare(`
      INSERT INTO activities (tipo, descrizione, user_id, metadata)
      VALUES ('login','Accesso al sistema',?,?)
    `).bind(
      userData.id,
      JSON.stringify({ 
        ip: c.req.header('CF-Connecting-IP') || 'unknown',
        fingerprint: pc_fingerprint || 'unknown'
      })
    ).run()

    return c.json({ success: true, user: userData })
  } catch (e: any) {
    console.error('LOGIN ERROR:', e)
    return c.json({ error: 'Errore interno del server' }, 500)
  }
})


app.post('/api/auth/logout', async (c) => {
  try {
    const { user_id } = await c.req.json()
    
    if (user_id) {
      await c.env.DB.prepare(`
        INSERT INTO activities (tipo, descrizione, user_id)
        VALUES ('logout','Disconnessione dal sistema', ?)
      `).bind(user_id).run()
    }

    return c.json({ success: true, message: 'Logout effettuato' })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

/* ---------------- VENDORS ---------------- */
app.get('/api/vendors', async (c) => {
  try {
    await ensureInit(c.env.DB)

    // Prendi TUTTI i venditori attivi (Sandra compresa)
    const r = await c.env.DB.prepare(`
      SELECT id, username, nome_completo
      FROM users
      WHERE role = 'venditore' AND attivo = 1
      ORDER BY nome_completo
    `).all()

    const vendors = (r.results || [])

    // Voce fittizia per “Appuntamenti interni” sempre in testa
    vendors.unshift({
      id: 0,
      username: 'interno',
      nome_completo: 'Appuntamenti interni'
    })

    return c.json({ success: true, vendors })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

/* ---------------- CUSTOMERS ---------------- */
/* ---------------- CUSTOMERS ---------------- */
app.get('/api/customers', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role')
    const uid = c.req.header('user-id')
    
    // Paginazione
    const page = Number(c.req.query('page') || 1)
    const limit = Number(c.req.query('limit') || 30)  
    const offset = (page - 1) * limit
    
    // Filtri
    const searchGeneral = (c.req.query('search') || '').toLowerCase().trim()
    const filterStato = (c.req.query('stato') || '').trim()
    const filterProvincia = (c.req.query('provincia') || '').trim()
    const filterDataDa = c.req.query('data_da') || ''
    const filterDataA = c.req.query('data_a') || ''
    
    let sql = 'SELECT c.*, u.nome_completo as assegnato_nome, 0 as promemoria_scaduti FROM customers c LEFT JOIN users u ON u.id = c.assegnato_a'
    const params: any[] = []
    const whereConditions: string[] = []

    // Filtro permessi (role venditore)
    if (role === 'venditore') {
      const canSeeAll = await hasScope(c.env.DB, Number(uid), 'agenda_all')
      if (!canSeeAll) {
        const userInfo = await c.env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(uid).first<{ username: string }>()
        const isInternalUser = userInfo?.username === SANDRA_USERNAME
        
        if (isInternalUser) {
          whereConditions.push('(c.assegnato_a = ? OR c.venditore_originale = ? OR EXISTS (SELECT 1 FROM appointments a WHERE a.customer_id = c.id AND a.interno = 1 AND a.user_id = ?) OR EXISTS (SELECT 1 FROM appointments a WHERE a.customer_id = c.id AND a.esito_vendita = \'non_venduto\'))')
          params.push(uid, uid, uid)
        }
      }
    }

    // Filtro ricerca generale
    if (searchGeneral) {
      whereConditions.push('(LOWER(c.nome || \' \' || c.cognome) LIKE ? OR LOWER(c.email) LIKE ? OR LOWER(c.telefono) LIKE ?)')
      const searchPattern = '%' + searchGeneral + '%'
      params.push(searchPattern, searchPattern, searchPattern)
    }

    // Filtro stato
    if (filterStato) {
      whereConditions.push('c.stato = ?')
      params.push(filterStato)
    }

    // Filtro provincia (supporta sia sigla che nome completo)
    if (filterProvincia) {
      // Mappa province per convertire sigla in nome completo
      const provinceMap: Record<string, string> = {
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
      
      const nomeCompleto = provinceMap[filterProvincia];
      
      // Cerca sia per sigla che per nome completo (case-insensitive)
      if (nomeCompleto) {
        whereConditions.push('(UPPER(c.provincia) = ? OR LOWER(c.provincia) = ?)')
        params.push(filterProvincia.toUpperCase(), nomeCompleto.toLowerCase())
      } else {
        // Se non è una sigla conosciuta, cerca per valore esatto
        whereConditions.push('UPPER(c.provincia) = ?')
        params.push(filterProvincia.toUpperCase())
      }
    }

    // Filtro date
    if (filterDataDa && filterDataA) {
      whereConditions.push('DATE(c.created_at) BETWEEN DATE(?) AND DATE(?)')
      params.push(filterDataDa, filterDataA)
    }

    // Aggiungi WHERE
    if (whereConditions.length > 0) {
      sql += ' WHERE ' + whereConditions.join(' AND ')
    }

    sql += ' ORDER BY c.created_at DESC LIMIT ? OFFSET ?'
    params.push(limit, offset)

    // Query count totale
    const countSqlBase = 'SELECT COUNT(*) as total FROM customers c'
    const countParams: any[] = []
    let countWhere = ''

    // Filtri permessi venditore (count)
    if (role === 'venditore') {
      const canSeeAll = await hasScope(c.env.DB, Number(uid), 'agenda_all')
      if (!canSeeAll) {
        const userInfo = await c.env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(uid).first<{ username: string }>()
        if (userInfo?.username === SANDRA_USERNAME) {
          countWhere = ' WHERE (c.assegnato_a = ? OR c.venditore_originale = ? OR EXISTS (SELECT 1 FROM appointments a WHERE a.customer_id = c.id AND a.interno = 1 AND a.user_id = ?))'
          countParams.push(uid, uid, uid)
        }
      }
    }

    // Filtri ricerca (count)
    if (searchGeneral) {
      const searchPattern = '%' + searchGeneral + '%'
      if (countWhere) {
        countWhere += ' AND (LOWER(c.nome || \' \' || c.cognome) LIKE ? OR LOWER(c.email) LIKE ? OR LOWER(c.telefono) LIKE ?)'
      } else {
        countWhere = ' WHERE (LOWER(c.nome || \' \' || c.cognome) LIKE ? OR LOWER(c.email) LIKE ? OR LOWER(c.telefono) LIKE ?)'
      }
      countParams.push(searchPattern, searchPattern, searchPattern)
    }

    if (filterStato) {
      countWhere += (countWhere ? ' AND ' : ' WHERE ') + 'c.stato = ?'
      countParams.push(filterStato)
    }

    if (filterProvincia) {
      // Usa la stessa mappa province
      const provinceMap: Record<string, string> = {
        'AG': 'Agrigento', 'AL': 'Alessandria', 'AN': 'Ancona', 'AO': 'Aosta', 'AP': 'Ascoli Piceno',
        'BO': 'Bologna', 'MI': 'Milano', 'RM': 'Roma', 'TO': 'Torino', 'FI': 'Firenze',
        // ... (aggiungi tutte le province come sopra)
      };
      
      const nomeCompleto = provinceMap[filterProvincia];
      
      if (nomeCompleto) {
        countWhere += (countWhere ? ' AND ' : ' WHERE ') + '(UPPER(c.provincia) = ? OR LOWER(c.provincia) = ?)'
        countParams.push(filterProvincia.toUpperCase(), nomeCompleto.toLowerCase())
      } else {
        countWhere += (countWhere ? ' AND ' : ' WHERE ') + 'UPPER(c.provincia) = ?'
        countParams.push(filterProvincia.toUpperCase())
      }
    }

    if (filterDataDa && filterDataA) {
      countWhere += (countWhere ? ' AND ' : ' WHERE ') + 'DATE(c.created_at) BETWEEN DATE(?) AND DATE(?)'
      countParams.push(filterDataDa, filterDataA)
    }

    const countSql = countSqlBase + countWhere
    const countResult = await c.env.DB.prepare(countSql).bind(...countParams).first<{ total: number }>()
    const total = countResult?.total || 0
    const totalPages = Math.ceil(total / limit)

    const rows = await c.env.DB.prepare(sql).bind(...params).all()
    
    return c.json({ 
      success: true, 
      customers: rows.results,
      pagination: { page, limit, total, totalPages }
    })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

//  Endpoint per ottenere tutte le province uniche presenti nel DB
app.get('/api/customers/provinces', async (c) => {
  try {
    await ensureInit(c.env.DB)
    
    // Query per ottenere tutte le province uniche (non null e non vuote)
    const result = await c.env.DB.prepare(`
      SELECT DISTINCT provincia 
      FROM customers 
      WHERE provincia IS NOT NULL AND provincia != ''
      ORDER BY provincia
    `).all()
    
    const provinces = result.results?.map((row: any) => row.provincia) || []
    
    return c.json({ success: true, provinces })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

app.get('/api/customers/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const id = c.req.param('id')
    const role = c.req.header('user-role')
    const uid = c.req.header('user-id')

   let sql = `
  SELECT 
    c.*, 
    u.nome_completo as assegnato_nome,

    -- campi utili per precompilare la modale cliente con i dati agenda
    (SELECT a.id
       FROM appointments a
      WHERE a.customer_id = c.id
      ORDER BY datetime(a.data_ora) DESC
      LIMIT 1)                                         AS last_app_id,
    (SELECT a.user_id
       FROM appointments a
      WHERE a.customer_id = c.id
      ORDER BY datetime(a.data_ora) DESC
      LIMIT 1)                                         AS last_app_user_id,
    (SELECT a.data_ora
       FROM appointments a
      WHERE a.customer_id = c.id
      ORDER BY datetime(a.data_ora) DESC
      LIMIT 1)                                         AS last_app_data_ora,
    (SELECT a.descrizione
       FROM appointments a
      WHERE a.customer_id = c.id
      ORDER BY datetime(a.data_ora) DESC
      LIMIT 1)                                         AS last_app_descrizione
  FROM customers c
  LEFT JOIN users u ON u.id = c.assegnato_a
  WHERE c.id = ?
`

    const params: any[] = [id]

        if (role === 'venditore') {
      const canSeeAll = await hasScope(c.env.DB, Number(uid), 'agenda_all');
      if (!canSeeAll) {
        // Verifica se è Sandra (utente interno)
        const userInfo = await c.env.DB
          .prepare('SELECT username FROM users WHERE id = ?')
          .bind(params[0])
          .first<{ username: string }>();
        
        const isInternalUser = userInfo?.username === SANDRA_USERNAME;
        
if (isInternalUser) {
  // Sandra può vedere clienti se:
  // 1) assegnati a lei OPPURE
  // 2) venditore_originale = Sandra (contratti interni) OPPURE
  // 3) hanno appuntamenti interni assegnati a lei OPPURE
  // 4) esiste una vendita registrata a suo nome
  sql += ` AND (
    c.assegnato_a = ?
    OR c.venditore_originale = ?
    OR EXISTS (
      SELECT 1 FROM appointments a 
      WHERE a.customer_id = c.id 
      AND a.interno = 1 
      AND a.user_id = ?
    )
    OR EXISTS (
      SELECT 1
      FROM sales s
      WHERE s.customer_id = c.id AND s.user_id = ?
    )
  )`;
  params.push(uid, uid, uid, uid);
}
      }
    }

    const row = await c.env.DB.prepare(sql).bind(...params).first()
    if (!row) return c.json({ error: 'Cliente non trovato o accesso negato' }, 404)

    return c.json({ success: true, customer: row })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

// Endpoint dedicato per recuperare tutte le province presenti nel database
app.get('/api/customers/provinces', async (c) => {
  try {
    await ensureInit(c.env.DB);
    
    // Recupera TUTTE le province univoche dal database
    const result = await c.env.DB.prepare(`
      SELECT DISTINCT UPPER(TRIM(provincia)) as provincia
      FROM customers
      WHERE provincia IS NOT NULL 
        AND provincia != ''
        AND LENGTH(TRIM(provincia)) > 0
      ORDER BY provincia ASC
    `).all();
    
    // Mappa province completa (sigla -> nome)
    const provinceMap: Record<string, string> = {
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
    
    // Mappa inversa (nome completo lowercase -> sigla)
    const reverseMap: Record<string, string> = {};
    Object.entries(provinceMap).forEach(([sigla, nome]) => {
      reverseMap[nome.toLowerCase()] = sigla;
    });
    
    // Normalizza le province dal DB
    const provincesNormalized = new Set<string>();
    
    (result.results || []).forEach((row: any) => {
      const prov = row.provincia?.trim();
      if (!prov) return;
      
      // Se è già una sigla (2-3 caratteri), usala direttamente
      if (prov.length <= 3) {
        provincesNormalized.add(prov.toUpperCase());
      } else {
        // Se è un nome completo, cerca la sigla corrispondente
        const sigla = reverseMap[prov.toLowerCase()];
        if (sigla) {
          provincesNormalized.add(sigla);
        } else {
          // Se non trovata nella mappa, usala comunque (potrebbe essere un formato insolito)
          provincesNormalized.add(prov.toUpperCase());
        }
      }
    });
    
    // Converti in array e crea oggetti con sigla e nome
    const provinces = Array.from(provincesNormalized)
      .sort()
      .map(sigla => ({
        sigla: sigla,
        nome: provinceMap[sigla] || sigla
      }));
    
    return c.json({ success: true, provinces });
  } catch (e: any) {
    console.error('Errore recupero province:', e);
    return c.json({ error: 'Errore: ' + e.message }, 500);
  }
});

app.post('/api/customers', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role')
    const uid = Number(c.req.header('user-id'))
    const b: any = await c.req.json()

    if (!b.nome || !b.cognome) {
      return c.json({ error: 'Nome e cognome sono obbligatori' }, 400)
    }

    const canAssign = role === 'admin' || await hasScope(c.env.DB, uid, 'agenda_all');
const assegnato = canAssign
  ? (b.assegnato_a ?? null)
  : (role === 'venditore' ? uid : null);
    const stato = b.stato || 'nuovo'

    const res: any = await c.env.DB.prepare(`
      INSERT INTO customers (nome,cognome,email,telefono,azienda,indirizzo,citta,cap,provincia,note,assegnato_a,stato,data_richiamo,numero_contratto,data_firma_contratto,venditore_firma,importo_contratto,prodotti_venduti)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).bind(
      b.nome, b.cognome, b.email, b.telefono, b.azienda, b.indirizzo, b.citta, b.cap, b.provincia, 
      b.note || null, assegnato, stato, b.data_richiamo || null,
      b.numero_contratto || null, b.data_firma_contratto || null, b.venditore_firma || null, 
      b.importo_contratto || b.importo || null, b.prodotti_venduti || null
    ).run()

    const customerId = res.meta?.last_row_id

    // Auto-appointment per stati "agendato"
if (stato === 'agendato con venditore' || stato === 'agendato interno') {
  let vendorId: number;
  let isInterno = 0;

  if (stato === 'agendato con venditore') {
    // Appuntamento con venditore specifico
    vendorId = Number(b.vendor_id || assegnato || uid);
    isInterno = 0;
  } else {
    // 🔧 Agendato interno -> SEMPRE assegnato a Sandra
    const sandraId = await getUserIdByUsername(c.env.DB, SANDRA_USERNAME);
    
    if (!sandraId) {
      console.error('❌ ERRORE: Utente Sandra non trovato nel database!');
      return c.json({ error: 'Utente interno (Sandra) non configurato nel sistema' }, 500);
    }
    
    vendorId = sandraId;
    isInterno = 1;
    
    console.log('✅ [POST /api/customers] Appuntamento interno creato per Sandra (ID:', sandraId, ')');
  }

   // 🆕 Imposta venditore_originale per appuntamenti interni
  if (isInterno === 1) {
    await c.env.DB.prepare(`
      UPDATE customers SET venditore_originale = ? WHERE id = ?
    `).bind(vendorId, customerId).run();
    
    console.log('✅ [POST /api/customers] Impostato venditore_originale:', vendorId);
  }
  
  
  // Costruisci data/ora: se arrivano data+ora dal body usale, altrimenti +1h
  let rawDate: Date;
  if (b.appuntamento_data && b.appuntamento_ora) {
    rawDate = new Date(`${b.appuntamento_data}T${b.appuntamento_ora}:00`);
  } else {
    rawDate = new Date(Date.now() + 3600_000);
  }

  // Salva in formato SQLite 'YYYY-MM-DD HH:MM:SS' (locale)
  const dataOraSql = toSqliteLocalDateTime(rawDate);

  await c.env.DB.prepare(`
    INSERT INTO appointments (
      customer_id, user_id, titolo, descrizione, data_ora, durata_min, stato, interno
    ) VALUES (?,?,?,?,?,?, 'programmato', ?)
  `).bind(
    customerId,
    vendorId,
    'Appuntamento',
    b.note || '',
    dataOraSql,
    60,
    isInterno
  ).run();
}
   
   // Auto-sale per "contratto firmato"
if ((stato === 'contratto firmato' || stato === 'contratto firmato ufficio') && Number(b.importo) > 0) {
  const numero = generateOrderNumber()
  
  // 🆕 Usa data_firma_contratto se fornita, altrimenti data odierna
  const dataVendita = b.data_firma_contratto || new Date().toISOString().split('T')[0]
  
  // 🆕 Trova ID del venditore che ha firmato il contratto
  let vendId = Number(assegnato || uid)
  if (b.venditore_firma) {
    const vendFirma = await c.env.DB.prepare(`
      SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND attivo = 1
    `).bind(b.venditore_firma).first<{ id: number }>()
    
    if (vendFirma) vendId = vendFirma.id
  }

  const numeroContratto = b.numero_contratto || null
  const s: any = await c.env.DB.prepare(`
    INSERT INTO sales (numero_ordine,customer_id,user_id,data_vendita,totale,stato,note,numero_contratto)
    VALUES (?,?,?,?,?,'confermata','Contratto firmato da scheda cliente',?)
  `).bind(numero, customerId, vendId, dataVendita, Number(b.importo), numeroContratto).run()

      await createOrderIfMissing(c.env.DB, s.meta?.last_row_id, customerId, b.prodotti_venduti)
    }

// Auto-crea rilievo per "contratto firmato"
 if (stato === 'contratto firmato' || stato === 'contratto firmato ufficio') {
      await c.env.DB.prepare(`
        INSERT INTO rilievi (customer_id, stato, tecnico_id)
        VALUES (?, 'da programmare', NULL)
      `).bind(customerId).run()
    }
	
    // CORREZIONE CRITICA: Gestione data_richiamo
const dataRich = normalizeDateOnly(b.data_richiamo);
if (dataRich) {
  // 🔧 Normalizza l'ora in formato HH:MM:SS
  let oraRich = b.ora_richiamo || null
  if (oraRich && oraRich.length === 5) {
    oraRich = oraRich + ':00'
  }
  
  await c.env.DB.prepare(`
    INSERT INTO promemoria (
      customer_id, user_id, tipo, data_promemoria, ora_promemoria, messaggio, stato
    ) VALUES (?, ?, 'richiama', ?, ?, 'Richiamare cliente', 'attivo')
  `).bind(
    customerId,
    Number(b.assegnato_a || uid),
    dataRich,
    oraRich
  ).run();
}


    if (uid) {
      await c.env.DB.prepare(`
        INSERT INTO activities (tipo,descrizione,customer_id,user_id,metadata)
        VALUES ('customer_created','Nuovo cliente creato',?,?,?)
      `).bind(customerId, uid, JSON.stringify({ stato })).run()
    }

// Logga l’aggiornamento cliente in Audit
try {
  await c.env.DB.prepare(`
    INSERT INTO activities (tipo, descrizione, customer_id, user_id, metadata)
    VALUES ('update_customer', 'Modifica cliente', ?, ?, ?)
  `).bind(
    customerId,  
    uid,
    JSON.stringify({ changed_fields: Object.keys(b) })
  ).run()
} catch {}

    return c.json({ success: true, customer_id: customerId })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

app.put('/api/customers/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || ''
    const uid  = Number(c.req.header('user-id') || 0)
    const id   = Number(c.req.param('id'))
    const b: any = await c.req.json()

    
        // Venditore: può modificare solo i propri clienti
if (role === 'venditore') {
  const canSeeAll = await hasScope(c.env.DB, uid, 'agenda_all');
  if (!canSeeAll) {
    // Verifica se è Sandra (utente interno)
    const userInfo = await c.env.DB
      .prepare('SELECT username FROM users WHERE id = ?')
      .bind(uid)
      .first<{ username: string }>();
    
    const isInternalUser = userInfo?.username === SANDRA_USERNAME;
    
    if (isInternalUser) {
      // Sandra può modificare clienti se:
      // 1) assegnati a lei OPPURE
      // 2) venditore_originale = Sandra OPPURE
      // 3) hanno appuntamenti interni assegnati a lei OPPURE
      // 4) hanno vendite registrate a suo nome
      const own = await c.env.DB.prepare(`
        SELECT 1 FROM customers c
        WHERE c.id = ? 
        AND (
          c.assegnato_a = ?
          OR c.venditore_originale = ?
          OR EXISTS (
            SELECT 1 FROM appointments a 
            WHERE a.customer_id = c.id 
            AND a.interno = 1 
            AND a.user_id = ?
          )
          OR EXISTS (
            SELECT 1 FROM sales s
            WHERE s.customer_id = c.id 
            AND s.user_id = ?
          )
        )
      `).bind(id, uid, uid, uid, uid).first();
      
      if (!own) return c.json({ error: 'Non autorizzato a modificare questo cliente' }, 403);
    } else {
      // Altri venditori possono modificare solo i loro clienti assegnati O con vendite
      const own = await c.env.DB.prepare(`
        SELECT 1 FROM customers c
        WHERE c.id = ? 
        AND (
          c.assegnato_a = ?
          OR EXISTS (
            SELECT 1 FROM sales s
            WHERE s.customer_id = c.id 
            AND s.user_id = ?
          )
        )
      `).bind(id, uid, uid).first();
      
      if (!own) return c.json({ error: 'Non autorizzato a modificare questo cliente' }, 403);
    }
  }
}

    // ---- Update anagrafica cliente ----
     const fields: string[] = []
    const vals: any[] = []
    const allowed = [
      'nome','cognome','email','telefono','azienda',
      'indirizzo','citta','cap','provincia','note',
      'codice_fiscale','partita_iva','codice_sdi',
      'cantiere_diverso','cantiere_indirizzo','cantiere_citta','cantiere_cap','cantiere_provincia',
      'stato','data_richiamo',
      'numero_contratto','data_firma_contratto','venditore_firma','importo_contratto','prodotti_venduti'
    ]
    
    console.log('🔍 [PUT /api/customers/:id] Body ricevuto:', JSON.stringify(b, null, 2));
    
    for (const k of allowed) {
      if (k in b) { 
        console.log(`🔍 [PUT /api/customers/:id] Campo ${k}:`, b[k]);
        fields.push(`${k} = ?`); 
        vals.push(b[k] ?? null) 
      }
    }

    // riassegnazione venditore (facoltativa)
    if ('assegnato_a' in b) {
      fields.push('assegnato_a = ?')
      vals.push(b.assegnato_a ? Number(b.assegnato_a) : null)
    }

    fields.push('updated_at = CURRENT_TIMESTAMP')
    vals.push(id)
    if (fields.length) {
      console.log('🔍 [PUT /api/customers/:id] SQL:', `UPDATE customers SET ${fields.join(', ')} WHERE id = ?`);
      console.log('🔍 [PUT /api/customers/:id] Valori:', vals);
      
      await c.env.DB
        .prepare(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`)
        .bind(...vals).run()
        
      console.log('✅ [PUT /api/customers/:id] Cliente aggiornato con successo');
    }

    // ---- CORREZIONE: Side effects SOLO se non esistono già ----
    // 1) Appuntamento automatico se agendato (VERIFICA SE ESISTE GIÀ)
   if (b.stato === 'agendato con venditore' || b.stato === 'agendato interno') {
  const existingAppointment = await c.env.DB
    .prepare('SELECT id FROM appointments WHERE customer_id = ? LIMIT 1')
    .bind(id)
    .first()

  let vendorId: number;
  let isInterno = 0;

  if (b.stato === 'agendato con venditore') {
    vendorId = Number(b.vendor_id || b.assegnato_a || uid);
    isInterno = 0;
  } else {
    // 🔧 Agendato interno -> SEMPRE assegnato a Sandra
    const sandraId = await getUserIdByUsername(c.env.DB, SANDRA_USERNAME);
    
    if (!sandraId) {
      console.error('❌ ERRORE: Utente Sandra non trovato nel database!');
      return c.json({ error: 'Utente interno (Sandra) non configurato nel sistema' }, 500);
    }
    
    vendorId = sandraId;
    isInterno = 1;
    
    console.log('✅ [PUT /api/customers/:id] Appuntamento interno assegnato a Sandra (ID:', sandraId, ')');
  }

  // 🔧 Costruisci data/ora in formato SQLite locale
let dataOraSql: string;
if (b.appuntamento_data && b.appuntamento_ora) {
  const rawDate = new Date(`${b.appuntamento_data}T${b.appuntamento_ora}:00`);
  dataOraSql = toSqliteLocalDateTime(rawDate);
} else {
  const rawDate = new Date(Date.now() + 3600_000);
  dataOraSql = toSqliteLocalDateTime(rawDate);
}

if (!existingAppointment) {
  // Crea nuovo appuntamento
  await c.env.DB.prepare(`
    INSERT INTO appointments (customer_id,user_id,titolo,descrizione,data_ora,durata_min,stato,interno)
    VALUES (?,?,?,?,?,?, 'programmato', ?)
  `).bind(
    id, vendorId, 'Appuntamento', b.note || '', dataOraSql, 60, isInterno
  ).run()
} else {
  // Aggiorna appuntamento esistente
  const updateFields: string[] = ['user_id = ?'];
  const updateVals: any[] = [vendorId];

  if (b.note) {
    updateFields.push('descrizione = ?');
    updateVals.push(b.note);
  }

  updateFields.push('data_ora = ?');
  updateVals.push(dataOraSql);

  updateFields.push('interno = ?', 'updated_at = CURRENT_TIMESTAMP');
  updateVals.push(isInterno);
  updateVals.push(existingAppointment.id);

  await c.env.DB.prepare(`
    UPDATE appointments SET ${updateFields.join(', ')} WHERE id = ?
  `).bind(...updateVals).run();
}
}

    // 2) Vendita + ordine se contratto firmato (VERIFICA SE ESISTE GIÀ)
   if ((b.stato === 'contratto firmato' || b.stato === 'contratto firmato ufficio') && Number(b.importo) > 0) {
  const existingSale = await c.env.DB
    .prepare('SELECT id FROM sales WHERE customer_id = ? LIMIT 1')
    .bind(id)
    .first()

  if (!existingSale) {
    const numero = generateOrderNumber()
    const dataVendita = b.data_firma_contratto || new Date().toISOString().split('T')[0]
    
    let vendId = Number(uid);
    
    // 🆕 Recupera venditore_originale se esiste (per appuntamenti interni di Sandra)
    const customerInfo = await c.env.DB.prepare(`
      SELECT venditore_originale FROM customers WHERE id = ?
    `).bind(id).first<{ venditore_originale: number | null }>();
    
    // 🆕 Priorità: venditore_originale > venditore_firma > assegnato_a > uid corrente
    if (customerInfo?.venditore_originale) {
      vendId = customerInfo.venditore_originale;
      console.log('✅ [PUT /api/customers/:id] Vendita assegnata a venditore_originale:', vendId);
    } else if (b.venditore_firma) {
      const vendFirma = await c.env.DB.prepare(`
        SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND attivo = 1
      `).bind(b.venditore_firma).first<{ id: number }>();
      
      if (vendFirma) {
        vendId = vendFirma.id;
        console.log('✅ [PUT /api/customers/:id] Vendita assegnata a venditore_firma:', vendId);
      }
    } else if (b.assegnato_a) {
      vendId = Number(b.assegnato_a);
    }
    
    const s: any = await c.env.DB.prepare(`
      INSERT INTO sales (numero_ordine,customer_id,user_id,data_vendita,totale,stato,note)
      VALUES (?,?,?,?,?,'confermata','Contratto firmato da scheda cliente')
    `).bind(numero, id, vendId, dataVendita, Number(b.importo)).run()

    await createOrderIfMissing(
      c.env.DB,
      s.meta?.last_row_id,
      id,
      b.prodotti_venduti
    )
  } else {
    // Aggiorna vendita esistente
    await c.env.DB.prepare(`
      UPDATE sales SET totale = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(Number(b.importo), existingSale.id).run()

    await createOrderIfMissing(
      c.env.DB,
      (existingSale as any).id,
      id,
      b.prodotti_venduti
    )
  }
}

 // Crea rilievo se non esiste
    if (b.stato === 'contratto firmato' || b.stato === 'contratto firmato ufficio') {
      const existingRilievo = await c.env.DB
        .prepare('SELECT id FROM rilievi WHERE customer_id = ? LIMIT 1')
        .bind(id)
        .first()
      
      if (!existingRilievo) {
        await c.env.DB.prepare(`
          INSERT INTO rilievi (customer_id, stato, tecnico_id)
          VALUES (?, 'da programmare', NULL)
        `).bind(id).run()
      }
    }

    // 3) Promemoria se viene passata la data richiamo (SEMPRE NUOVO - È NORMALE)
const dataRich = normalizeDateOnly(b.data_richiamo);
if (dataRich) {
  const assigned = ('assegnato_a' in b && b.assegnato_a != null) ? Number(b.assegnato_a) : uid;
  
  //  Normalizza l'ora in formato HH:MM:SS
  let oraRich = b.ora_richiamo || null
  if (oraRich && oraRich.length === 5) {
    oraRich = oraRich + ':00'
  }
  
  await c.env.DB.prepare(`
  INSERT INTO promemoria (
    customer_id, user_id, tipo, data_promemoria, ora_promemoria, messaggio, stato
  ) VALUES (?, ?, 'richiama', ?, ?, 'Richiamare cliente', 'attivo')
`).bind(
  id,
  assigned,
  dataRich,
  oraRich
).run();
}  // ← Chiude if (dataRich)

    // ✅ AGGIUNGI QUESTE RIGHE VUOTE + } se necessario
    
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

app.put('/api/appointments/:id', async (c) => {
  try {
    await ensureInit(c.env.DB);

    const role = c.req.header('user-role') || '';
    const uid  = Number(c.req.header('user-id') || 0);
    const id   = Number(c.req.param('id'));
const canAll = role === 'admin' ? true : await hasScope(c.env.DB, uid, 'agenda_all')

// Venditore senza agenda_all: può toccare solo i propri appuntamenti
if (!canAll && role === 'venditore') {
  const own = await c.env.DB
    .prepare('SELECT 1 FROM appointments WHERE id = ? AND user_id = ?')
    .bind(id, uid)
    .first();
  if (!own) return c.json({ error: 'Non autorizzato' }, 403);
}

    const b: any = await c.req.json();

    // --- UPDATE campi appuntamento ---
    const fields: string[] = [];
    const vals: any[] = [];
    if (('user_id' in b) && canAll) {
     fields.push('user_id = ?');
     vals.push(Number(b.user_id) || null);
}
    const setIf = (col: string, present: boolean, val: any) => {
      if (!present) return;
      fields.push(`${col} = ?`);
      vals.push(val);
    };

    setIf('titolo',          'titolo' in b, b.titolo);
    setIf('descrizione',     'descrizione' in b, b.descrizione ?? null);
    setIf('data_ora',        'data_ora' in b, b.data_ora);
    setIf('durata_min',      'durata_min' in b, b.durata_min);
    setIf('stato',           'stato' in b, b.stato);
    setIf('contratto_chiuso','contratto_chiuso' in b, b.contratto_chiuso ? 1 : 0);
    setIf('importo',         'importo' in b, Number(b.importo) || 0);
    setIf('esito_vendita', 'esito_vendita' in b, b.esito_vendita || null);
	
	
    if ('prodotti_venduti' in b) {
      fields.push('prodotti_venduti = ?');
      vals.push(b.prodotti_venduti ? JSON.stringify(b.prodotti_venduti) : null);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(id);

    if (fields.length) {
      await c.env.DB
        .prepare(`UPDATE appointments SET ${fields.join(', ')} WHERE id = ?`)
        .bind(...vals)
        .run();
    }

    // --- Vendita/Ordine se contratto chiuso ---
    if (b.contratto_chiuso && Number(b.importo) > 0) {
      const ap = await c.env.DB
        .prepare('SELECT customer_id, user_id FROM appointments WHERE id = ?')
        .bind(id)
        .first<{ customer_id: number; user_id: number }>();

      if (ap) {
        const existing = await c.env.DB
          .prepare('SELECT id FROM sales WHERE appointment_id = ?')
          .bind(id)
          .first<{ id: number }>();

        let saleId: number;
        if (!existing) {
          const numero = generateOrderNumber();
          const giorno = new Date().toISOString().slice(0, 10);

         const numeroContratto = b.numero_contratto || null
          const sIns: any = await c.env.DB.prepare(`
            INSERT INTO sales (numero_ordine, customer_id, user_id, data_vendita, totale, stato, note, appointment_id, numero_contratto)
            VALUES (?,?,?,?,?,'confermata','Vendita da appuntamento',?,?)
          `).bind(numero, ap.customer_id, ap.user_id, giorno, Number(b.importo), id, numeroContratto).run();

          saleId = sIns.meta?.last_row_id;
        } else {
          saleId = existing.id;
          await c.env.DB
            .prepare('UPDATE sales SET totale = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .bind(Number(b.importo), saleId)
            .run();
        }

        const prodottiVenduti = b.prodotti_venduti ? JSON.stringify(b.prodotti_venduti) : null;
        await createOrderIfMissing(c.env.DB, saleId, ap.customer_id, prodottiVenduti);
      }
    }
        
		//  Auto-crea rilievo se contratto chiuso
    if (b.contratto_chiuso) {
      const ap = await c.env.DB
        .prepare('SELECT customer_id FROM appointments WHERE id = ?')
        .bind(id)
        .first<{ customer_id: number }>()

      if (ap?.customer_id) {
        const existingRilievo = await c.env.DB
          .prepare('SELECT id FROM rilievi WHERE customer_id = ? LIMIT 1')
          .bind(ap.customer_id)
          .first()
        
        if (!existingRilievo) {
          await c.env.DB.prepare(`
            INSERT INTO rilievi (customer_id, stato, tecnico_id)
            VALUES (?, 'da programmare', NULL)
          `).bind(ap.customer_id).run()
        }

        //  IMPORTANTE: Aggiorna anche lo stato del cliente a "contratto firmato"
        await c.env.DB.prepare(`
          UPDATE customers 
          SET stato = 'contratto firmato', updated_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).bind(ap.customer_id).run()
      }
    }
    // --- [SYNC] Patch anagrafica cliente (opzionale) ---
    try {
      const customerPatch = (b as any).customer_patch || {};

      // opzionale: copia descrizione appuntamento in note cliente
      if ((b as any).sync_note_to_customer && b.descrizione && !customerPatch.note) {
        customerPatch.note = b.descrizione;
      }

      // mappa eventuali top-level nel patch se non presenti
      for (const k of ['telefono','indirizzo','citta','cap','provincia','note','email','nome','cognome','azienda']) {
        if (b[k] !== undefined && customerPatch[k] === undefined) {
          customerPatch[k] = b[k];
        }
      }

      const allowed = ['nome','cognome','email','telefono','azienda','indirizzo','citta','cap','provincia','note'];
      const set: string[] = [];
      const vals2: any[] = [];

      for (const k of allowed) {
        if (customerPatch[k] !== undefined) {
          set.push(`${k} = ?`);
          vals2.push(customerPatch[k]);
        }
      }

      if (set.length) {
        // trova il customer_id se non passato
        let targetCustomerId = b.customer_id as number | undefined;
        if (!targetCustomerId) {
          const row = await c.env.DB
            .prepare('SELECT customer_id FROM appointments WHERE id = ?')
            .bind(id)
            .first<{ customer_id: number }>();
          targetCustomerId = row?.customer_id;
        }

        if (targetCustomerId) {
          set.push('updated_at = CURRENT_TIMESTAMP');
          vals2.push(targetCustomerId);
          await c.env.DB
            .prepare(`UPDATE customers SET ${set.join(', ')} WHERE id = ?`)
            .bind(...vals2)
            .run();
        }
      }
    } catch (e) {
      console.error('[SYNC customer on appointment update]', (e as any)?.message);
    }

    return c.json({ success: true });
  } catch (e: any) {
    console.error('[APPOINTMENT UPDATE ERROR]', e);
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500);
  }
});


app.delete('/api/customers/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)

    const role = c.req.header('user-role') || ''
    const uid  = Number(c.req.header('user-id') || 0)
    const id   = Number(c.req.param('id'))

    // Admin possono sempre eliminare
    if (role !== 'admin') {
      // Non admin: concedi se hanno lo scope agenda_all (Olga e Giulia ce l'hanno)
      const canDeleteAll = await hasScope(c.env.DB, uid, 'agenda_all')
      if (!canDeleteAll) {
        return c.json({ error: 'Accesso negato' }, 403)
      }
    }

    await deleteCustomerDeep(c.env.DB, id)

    if (uid) {
      await c.env.DB.prepare(`
        INSERT INTO activities (tipo,descrizione,user_id,metadata)
        VALUES ('customer_deleted','Cliente eliminato',?,?)
      `).bind(uid, JSON.stringify({ customer_id: id })).run()
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

// Endpoint per generare PDF scheda cliente
app.get('/api/customers/:id/pdf', async (c) => {
  try {
    await ensureInit(c.env.DB);
    const customerId = c.req.param('id');
    
    // Recupera dati cliente
    const customer = await c.env.DB.prepare(`
      SELECT c.*, 
             (SELECT COUNT(*) FROM promemoria p WHERE p.customer_id = c.id AND p.stato = 'attivo') as promemoria_attivi
      FROM customers c
      WHERE c.id = ?
    `).bind(customerId).first<any>();
    
    if (!customer) {
      return c.json({ error: 'Cliente non trovato' }, 404);
    }
    
    // Recupera vendita/contratto del cliente (se esiste)
    const sale = await c.env.DB.prepare(`
      SELECT numero_contratto, data_vendita, totale
      FROM sales
      WHERE customer_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(customerId).first<any>();
    
    // Genera HTML per il PDF
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page {
      size: A4;
      margin: 15mm 12mm;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: Arial, sans-serif; 
      padding: 0;
      font-size: 11pt;
      line-height: 1.2;
    }
    .container { 
      border: 2px solid #000; 
      padding: 3mm;
      min-height: 270mm;
    }
    .section { 
      border: 1px solid #000; 
      margin-bottom: 4mm;
    }
    .row { 
      display: flex; 
      border-bottom: 1px solid #000;
      min-height: 10mm;
      align-items: center;
    }
    .row:last-child { border-bottom: none; }
    .label { 
      width: 25%; 
      padding: 3mm; 
      border-right: 1px solid #000; 
      font-weight: bold;
      font-size: 11pt;
      background-color: #f5f5f5;
    }
    .value { 
      width: 75%; 
      padding: 3mm;
      font-size: 11pt;
    }
    table { 
      width: 100%; 
      border-collapse: collapse; 
      margin-top: 4mm;
    }
    th, td { 
      border: 1px solid #000; 
      padding: 2mm; 
      text-align: left;
      font-size: 12pt;
      vertical-align: middle;
    }
    th { 
      background-color: #e8e8e8; 
      font-weight: bold;
      font-size: 12pt;
      line-height: 1.2;
      padding: 2mm;
    }
    .empty-row { height: 9mm; }
    .header { 
      text-align: center; 
      font-size: 12pt; 
      font-weight: bold; 
      margin-bottom: 2mm;
      padding: 3mm;
      border: 1px solid #000;
      background-color: #f0f0f0;
    }
    .section-title {
      font-size: 12pt;
      font-weight: bold;
      margin-top: 1mm;
      margin-bottom: 3mm;
      text-align: center;
      background-color: #e0e0e0;
      padding: 3mm;
      border: 2px solid #000;
    }
  </style>
</head>
<body>
  <div class="container">
    
    <!-- DATI CLIENTE -->
    <div class="section">
      <div class="row">
        <div class="label">CLIENTE:</div>
        <div class="value">${customer.nome || ''} ${customer.cognome || ''}</div>
      </div>
      <div class="row">
        <div class="label">NUM:</div>
        <div class="value">${customer.telefono || ''}</div>
      </div>
      <div class="row">
        <div class="label">EMAIL:</div>
        <div class="value">${customer.email || ''}</div>
      </div>
      <div class="row">
        <div class="label">VIA:</div>
        <div class="value">
          ${customer.indirizzo || ''}${customer.citta ? ', ' + customer.citta : ''}${customer.provincia ? ' (' + customer.provincia + ')' : ''}
        </div>
      </div>
      ${customer.codice_fiscale ? `
      <div class="row">
        <div class="label">CF:</div>
        <div class="value">${customer.codice_fiscale}</div>
      </div>
      ` : ''}
      ${customer.partita_iva ? `
      <div class="row">
        <div class="label">P.IVA:</div>
        <div class="value">${customer.partita_iva}</div>
      </div>
      ` : ''}
      ${customer.codice_sdi ? `
      <div class="row">
        <div class="label">COD. SDI:</div>
        <div class="value">${customer.codice_sdi}</div>
      </div>
      ` : ''}
    </div>
    
    <!-- TABELLA ATTIVITÀ -->
    <table>
      <thead>
        <tr>
          <th style="width: 30%;">ATTIVITÀ</th>
          <th style="width: 35%;">DATA</th>
          <th style="width: 35%;">NOTE</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>PREVENTIVO FIRMATO</strong></td>
         <td>${customer.numero_contratto ? 'N° ' + customer.numero_contratto : ''}<br>${customer.data_firma_contratto || ''}</td>
          <td></td>
        </tr>
        <tr class="empty-row">
          <td><strong>FATTURA</strong></td>
          <td></td>
          <td></td>
        </tr>
        <tr class="empty-row">
          <td><strong>RILIEVO</strong></td>
          <td></td>
          <td></td>
        </tr>
        <tr class="empty-row">
          <td><strong>CAPARRA</strong></td>
          <td></td>
          <td></td>
        </tr>
        <tr class="empty-row">
          <td><strong>FINANZIAMENTO</strong></td>
          <td></td>
          <td></td>
        </tr>
      </tbody>
    </table>
    
    <!-- SEZIONE ORDINI PRODOTTI -->
    <div class="section-title">ORDINI PRODOTTI</div>
    <table>
      <thead>
        <tr>
          <th style="width: 28%;">PRODOTTO</th>
          <th style="width: 18%;">MANDATA<br>RICHIESTA</th>
          <th style="width: 18%;">CONTROLLO<br>DOPPIA FIRMA</th>
          <th style="width: 18%;">ORDINATI<br>DATA</th>
          <th style="width: 18%;">PAGATO</th>
        </tr>
      </thead>
      <tbody>
        <tr class="empty-row">
          <td><strong>ORDINE SERRAMENTI</strong></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
        <tr class="empty-row">
          <td><strong>ORDINE CASSONETTI</strong></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
        <tr class="empty-row">
          <td><strong>ORDINE PERSIANE/SCURI</strong></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
        <tr class="empty-row">
          <td><strong>ORDINE ZANZARIERE</strong></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
        <tr class="empty-row">
          <td><strong>ORDINE TAPPARELLE</strong></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
        <tr class="empty-row">
          <td><strong>ORDINE PORTE INTERNE</strong></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
        <tr class="empty-row">
          <td><strong>ORDINE PORTE BLINDATE</strong></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </div>
</body>
</html>`;
    
    // Ritorna HTML che verrà convertito in PDF dal frontend
    return c.html(html);
    
  } catch (e: any) {
    console.error('Errore generazione PDF:', e);
    return c.json({ error: 'Errore generazione PDF: ' + e.message }, 500);
  }
});
/* ---------------- APPOINTMENTS (AGENDA) ---------------- */

app.get('/api/appointments', async (c) => {
  try {
    await ensureInit(c.env.DB)

    const role  = c.req.header('user-role') || ''
    const uid   = c.req.header('user-id') || ''
    const from  = c.req.query('from') || null          // es. 2024-11-01
    const to    = c.req.query('to')   || null          // es. 2024-11-30
    const month = c.req.query('month') || c.req.query('m') || null // 1..12
    const year  = c.req.query('year')  || c.req.query('y') || null // YYYY
	const vendor  = c.req.query('vendor') || c.req.query('user_id') || null // accetto entrambi
    const interno = c.req.query('interno') || null                         // '1' per solo interni
    
	 const page = Number(c.req.query('page') || 1)
    const limit = Number(c.req.query('limit') || 50)
    const offset = (page - 1) * limit
	
    let where = `WHERE 1=1`
    const params: any[] = []

    if (from && to) {
      // filtro per range di date (inclusivo)
      where += ` AND date(a.data_ora) BETWEEN ? AND ?`
      params.push(from, to)
    } else if (month && year) {
      // filtro per mese/anno (usa funzioni SQLite su DATETIME)
      where += ` AND strftime('%Y', a.data_ora) = ? AND strftime('%m', a.data_ora) = printf('%02d', ?)`
      params.push(String(year), Number(month))
    } else {
      // DEFAULT: mostra dal mese corrente fino a +6 mesi (così vedi anche quelli futuri)
      where += ` AND date(a.data_ora) BETWEEN date('now','-6 months') AND date('now','+6 months')`
    }

    // Filtro esplicito per venditore o per interni
if (interno === '1' || vendor === 'interno') {
  // solo appuntamenti interni
  where += ` AND a.interno = 1`
} else if (vendor && /^\d+$/.test(String(vendor))) {
  // solo appuntamenti del venditore scelto
  where += ` AND a.user_id = ?`
  params.push(Number(vendor))
}

   // Logica visibilità appuntamenti per venditori
if (role === 'venditore') {
  // Ottieni username dell'utente loggato
  const userInfo = await c.env.DB
    .prepare('SELECT username FROM users WHERE id = ?')
    .bind(uid)
    .first<{ username: string }>();

  const isInternalUser = userInfo?.username === SANDRA_USERNAME;
  const canSeeAll = await hasScope(c.env.DB, Number(uid), 'agenda_all');

  if (isInternalUser) {
    // Sandra (utente interno): vede SOLO appuntamenti interni assegnati a lei
    where += ` AND a.interno = 1 AND a.user_id = ?`;
    params.push(uid);
  } else if (!canSeeAll) {
    // Venditore normale senza agenda_all: vede solo i propri
    where += ` AND a.user_id = ?`;
    params.push(uid);
  }
  // Se canSeeAll = true E non è Sandra: vede tutto (Olga, Giulia)
}


    const rs = await c.env.DB.prepare(`
      SELECT
        a.*,
        (c.nome || ' ' || c.cognome)           AS cliente,
        u.nome_completo                        AS venditore,
        c.telefono                             AS customer_telefono,
        c.provincia                            AS provincia,
        c.indirizzo                            AS customer_indirizzo,
        c.note                                 AS customer_note,
        COALESCE(NULLIF(a.descrizione, ''), c.note) AS descrizione_unificata
      FROM appointments a
      LEFT JOIN customers c ON c.id = a.customer_id
      LEFT JOIN users     u ON u.id = a.user_id
      ${where}
      ORDER BY a.data_ora ASC
    `).bind(...params).all()

    return c.json({ appointments: rs.results || [] })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})


app.post('/api/appointments', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    const canAll = role === 'admin' ? true : await hasScope(c.env.DB, uid, 'agenda_all');

    const b: any = await c.req.json()

    if (!b.customer_id || !b.titolo || !b.data_ora) {
      return c.json({ error: 'Campi obbligatori mancanti' }, 400)
    }

    const canAssign = (role === 'admin') || await hasScope(c.env.DB, uid, 'agenda_all');
    
    //  Determina user_id e flag interno
    let targetUser: number;
    let isInterno: number;
    
    if (b.interno === true || b.interno === 1) {
      // Se è marcato come interno, assegna SEMPRE a Sandra
      const sandraId = await getUserIdByUsername(c.env.DB, SANDRA_USERNAME);
      if (!sandraId) {
        return c.json({ error: 'Utente interno (Sandra) non configurato' }, 500);
      }
      targetUser = sandraId;
      isInterno = 1;
      console.log('✅ [POST /api/appointments] Appuntamento interno creato per Sandra (ID:', sandraId, ')');
    } else {
      // Appuntamento normale
      targetUser = (canAssign && b.user_id) ? Number(b.user_id) : uid;
      isInterno = 0;
    }
    
    // 🔧 Normalizza data/ora in formato SQLite locale (YYYY-MM-DD HH:MM:SS)
    let dataOra = b.data_ora;
    if (dataOra) {
      // Se arriva nel formato ISO (2024-12-15T14:00:00), usa direttamente
      if (dataOra.includes('T')) {
        dataOra = dataOra.replace('T', ' ').substring(0, 19);
      }
      // Se arriva già nel formato corretto, lascialo così
    }

   const res: any = await c.env.DB.prepare(`
  INSERT INTO appointments (customer_id,user_id,titolo,descrizione,data_ora,durata_min,stato,interno,contratto_chiuso,importo,prodotti_venduti,esito_vendita)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
`).bind(
  b.customer_id, targetUser, b.titolo, b.descrizione || null, dataOra,
  b.durata_min || 60, b.stato || 'programmato', isInterno,
  b.contratto_chiuso ? 1 : 0,
  Number(b.importo) || 0,
  b.prodotti_venduti ? JSON.stringify(b.prodotti_venduti) : null,
  b.esito_vendita || null
).run()

// 🔹 MODIFICA 2B: Se appuntamento interno, imposta venditore_originale
if (isInterno === 1) {
  await c.env.DB.prepare(`
    UPDATE customers SET venditore_originale = ? WHERE id = ?
  `).bind(targetUser, b.customer_id).run();
  
  console.log('✅ [POST /api/appointments] Impostato venditore_originale:', targetUser, 'per cliente:', b.customer_id);
}

// Se contratto chiuso, crea vendita e ordine
if (b.contratto_chiuso && Number(b.importo) > 0) {
      const numero = generateOrderNumber()
      const giorno = new Date().toISOString().split('T')[0]

      const numeroContratto = b.numero_contratto || null
      const sIns: any = await c.env.DB.prepare(`
        INSERT INTO sales (numero_ordine,customer_id,user_id,data_vendita,totale,stato,note,appointment_id,numero_contratto)
        VALUES (?,?,?,?,?,'confermata','Vendita da appuntamento',?,?)
      `).bind(numero, b.customer_id, targetUser, giorno, Number(b.importo), res.meta?.last_row_id, numeroContratto).run()

      const prodottiVenduti = b.prodotti_venduti ? JSON.stringify(b.prodotti_venduti) : null
      await createOrderIfMissing(c.env.DB, sIns.meta?.last_row_id, b.customer_id, prodottiVenduti)
    }

    /* [SYNC] Aggiorna l'anagrafica cliente se richiesto dal front-end */
    try {
      const customerPatch = (b as any).customer_patch || {}

      // opzionale: copia descrizione appuntamento nelle note cliente
      if ((b as any).sync_note_to_customer && b.descrizione && !customerPatch.note) {
        customerPatch.note = b.descrizione
      }

      // prendo eventuali campi top-level se presenti
      for (const k of ['telefono','indirizzo','citta','cap','provincia','note','email','nome','cognome','azienda']) {
        if (b[k] !== undefined && customerPatch[k] === undefined) {
          customerPatch[k] = b[k]
        }
      }

      const allowed = ['nome','cognome','email','telefono','azienda','indirizzo','citta','cap','provincia','note']
      const set: string[] = []
      const vals: any[] = []

      for (const k of allowed) {
        if (customerPatch[k] !== undefined) {
          set.push(`${k} = ?`)
          vals.push(customerPatch[k])
        }
      }

      if (set.length && b.customer_id) {
        set.push('updated_at = CURRENT_TIMESTAMP')
        vals.push(b.customer_id)
        await c.env.DB.prepare(`UPDATE customers SET ${set.join(', ')} WHERE id = ?`).bind(...vals).run()
      }
    } catch (e: any) {
      console.error('[SYNC customer on appointment create]', e?.message)
    }

    // 📅 COPIA AUTOMATICA NEL CALENDARIO MONTAGGI
    console.log('🔵 INIZIO COPIA AUTOMATICA IN MONTAGGI');
    console.log('🔵 dataOra:', dataOra);
    console.log('🔵 customer_id:', b.customer_id);
    console.log('🔵 titolo:', b.titolo);
    
    try {
      const appointmentId = res.meta?.last_row_id;
      
      // Estrai solo la data da data_ora (formato: YYYY-MM-DD HH:MM:SS -> YYYY-MM-DD)
      const dataMontaggio = dataOra ? dataOra.split(' ')[0] : null;
      
      // Estrai solo l'ora (formato: YYYY-MM-DD HH:MM:SS -> HH:MM:SS)
      const oraMontaggio = dataOra ? dataOra.split(' ')[1] || '00:00:00' : '00:00:00';
      
      console.log('🔵 dataMontaggio:', dataMontaggio);
      console.log('🔵 oraMontaggio:', oraMontaggio);
      
      await c.env.DB.prepare(`
        INSERT INTO montaggi (
          order_id, customer_id, product_type, data_montaggio, ora_montaggio, 
          montatori, stato, note, priorita, created_at
        ) VALUES (0, ?, 'rilievo', ?, ?, ?, 'programmato', ?, 'normale', CURRENT_TIMESTAMP)
      `).bind(
        b.customer_id,
        dataMontaggio,
        oraMontaggio,
        b.titolo || 'Rilievo',
        `Appuntamento: ${b.titolo || ''} - ${b.descrizione || ''}`
      ).run();
      
      console.log('✅ Appuntamento copiato nel calendario montaggi');
    } catch (e) {
      console.error('⚠️ Errore copia appuntamento in montaggi:', e);
      // Non blocchiamo la creazione dell'appuntamento
    }

    return c.json({ success: true, id: res.meta?.last_row_id })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})



app.put('/api/appointments/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role')
    const uid = Number(c.req.header('user-id'))
    const id = Number(c.req.param('id'))

    // Venditore può toccare solo i propri appuntamenti
    if (role === 'venditore') {
      const own = await c.env.DB.prepare(
        `SELECT 1 FROM appointments WHERE id = ? AND user_id = ?`
      ).bind(id, uid).first()
      if (!own) return c.json({ error: 'Non autorizzato' }, 403)
    }

    const b: any = await c.req.json()

    // Dati base (ci servono per sales e sync)
    const apBase = await c.env.DB.prepare(
      `SELECT customer_id, user_id FROM appointments WHERE id = ?`
    ).bind(id).first<{ customer_id: number; user_id: number }>()
    if (!apBase) return c.json({ error: 'Appuntamento non trovato' }, 404)

    // --- Update campi appuntamento ---
    const fields: string[] = []
    const vals: any[] = []

    for (const k of ['titolo', 'descrizione', 'data_ora', 'durata_min', 'stato']) {
      if (k in b) {
        fields.push(`${k} = ?`)
        vals.push(b[k])
      }
    }

    // Consenti all'admin di riassegnare il venditore
    const canAssign = (role === 'admin') || await hasScope(c.env.DB, uid, 'agenda_all');
if (canAssign && 'user_id' in b) {
  fields.push('user_id = ?');
  vals.push(Number(b.user_id) || null);
}

    if ('contratto_chiuso' in b) {
      fields.push('contratto_chiuso = ?')
      vals.push(b.contratto_chiuso ? 1 : 0)
    }

    if ('importo' in b) {
      fields.push('importo = ?')
      vals.push(Number(b.importo) || 0)
    }

    if ('prodotti_venduti' in b) {
      fields.push('prodotti_venduti = ?')
      vals.push(b.prodotti_venduti ? JSON.stringify(b.prodotti_venduti) : null)
    }

    if ('esito_vendita' in b) {
      fields.push('esito_vendita = ?')
      vals.push(b.esito_vendita || null)
    }

    fields.push('updated_at = CURRENT_TIMESTAMP')
    vals.push(id)

    if (fields.length) {
      await c.env.DB.prepare(
        `UPDATE appointments SET ${fields.join(', ')} WHERE id = ?`
      ).bind(...vals).run()
    }

    // --- Se contratto chiuso, crea/aggiorna vendita e crea ordine se manca ---
    if (b.contratto_chiuso && Number(b.importo) > 0) {
      const esiste = await c.env.DB.prepare(
        `SELECT id FROM sales WHERE appointment_id = ?`
      ).bind(id).first()

      let saleId: number
      if (!esiste) {
        const numero = generateOrderNumber()
        const giorno = new Date().toISOString().split('T')[0]
        const numeroContratto = b.numero_contratto || null
        const sIns: any = await c.env.DB.prepare(`
          INSERT INTO sales (numero_ordine,customer_id,user_id,data_vendita,totale,stato,note,appointment_id,numero_contratto)
          VALUES (?,?,?,?,?,'confermata','Vendita da appuntamento',?,?)
        `).bind(
          numero,
          apBase.customer_id,
          // se l'admin ha cambiato user_id in questo update, usiamolo, altrimenti quello già in DB
          (role === 'admin' && 'user_id' in b) ? Number(b.user_id) : apBase.user_id,
          giorno,
          Number(b.importo),
          id,
          numeroContratto
        ).run()
        saleId = sIns.meta?.last_row_id
      } else {
        saleId = (esiste as any).id
        await c.env.DB.prepare(
          `UPDATE sales SET totale = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).bind(Number(b.importo), saleId).run()
      }

      const prodottiVenduti = b.prodotti_venduti ? JSON.stringify(b.prodotti_venduti) : null
      await createOrderIfMissing(c.env.DB, saleId, apBase.customer_id, prodottiVenduti)
    }

    // --- [SYNC] Patch anagrafica cliente opzionale ---
    try {
      const customerPatch = (b as any).customer_patch || {}

      // opzionale: usa descrizione appuntamento come note cliente
      if ((b as any).sync_note_to_customer && b.descrizione && !customerPatch.note) {
        customerPatch.note = b.descrizione
      }

      // accetta anche eventuali campi top-level
      for (const k of ['telefono','indirizzo','citta','cap','provincia','note','email','nome','cognome','azienda']) {
        if (b[k] !== undefined && customerPatch[k] === undefined) {
          customerPatch[k] = b[k]
        }
      }

      const allowed = ['nome','cognome','email','telefono','azienda','indirizzo','citta','cap','provincia','note']
      const set: string[] = []
      const vals2: any[] = []

      for (const k of allowed) {
        if (customerPatch[k] !== undefined) {
          set.push(`${k} = ?`)
          vals2.push(customerPatch[k])
        }
      }

      if (set.length && apBase?.customer_id) {
        set.push('updated_at = CURRENT_TIMESTAMP')
        vals2.push(apBase.customer_id)
        await c.env.DB.prepare(
          `UPDATE customers SET ${set.join(', ')} WHERE id = ?`
        ).bind(...vals2).run()
      }
    } catch (e: any) {
      console.error('[SYNC customer on appointment update]', e?.message)
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

app.delete('/api/appointments/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role')
    const uid = c.req.header('user-id')
    const id = c.req.param('id')

    if (role === 'venditore') {
  const canSeeAll = await hasScope(c.env.DB, Number(uid), 'agenda_all');
  if (!canSeeAll) {
    const own = await c.env.DB.prepare(
      `SELECT 1 FROM appointments WHERE id = ? AND user_id = ?`
    ).bind(id, uid).first();
    if (!own) return c.json({ error: 'Non autorizzato' }, 403);
  }
}

    await deleteAppointmentDeep(c.env.DB, id)
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

/* ---------------- RECALLS (Richiami Sandra) ---------------- */

// GET /api/recalls - Lista appuntamenti "non venduto"
app.get('/api/recalls', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || ''
    const uid = c.req.header('user-id') || ''
    const stato = c.req.query('stato') || '' // 'programmato', 'completato', 'annullato'
    const from = c.req.query('from') || null
    const to = c.req.query('to') || null

    let where = "WHERE a.esito_vendita = 'non_venduto'"
    const params: any[] = []

     // Sandra vede TUTTI i recall (non venduti), indipendentemente dal venditore
    // Altri venditori non hanno accesso ai recall
    if (role === 'venditore') {
      const userInfo = await c.env.DB
        .prepare('SELECT username FROM users WHERE id = ?')
        .bind(uid)
        .first<{ username: string }>();
      
      if (!userInfo || userInfo.username.toLowerCase() !== SANDRA_USERNAME.toLowerCase()) {
        return c.json({ error: 'Non autorizzato' }, 403);
      }
      
      // Sandra vede TUTTI gli appuntamenti non venduti, non solo i suoi
      // (rimuoviamo il filtro su user_id)
    }

    // Filtro stato appuntamento
    if (stato) {
      where += ' AND a.stato = ?'
      params.push(stato)
    }

    // Filtro date
    if (from && to) {
      where += ' AND date(a.data_ora) BETWEEN ? AND ?'
      params.push(from, to)
    }

    const rs = await c.env.DB.prepare(`
      SELECT
        a.*,
        (c.nome || ' ' || c.cognome) AS cliente,
        c.telefono AS customer_telefono,
        c.email AS customer_email,
        c.provincia,
        c.indirizzo AS customer_indirizzo,
        c.note AS customer_note,
        u.nome_completo AS venditore
      FROM appointments a
      LEFT JOIN customers c ON c.id = a.customer_id
      LEFT JOIN users u ON u.id = a.user_id
      ${where}
      ORDER BY a.data_ora DESC
    `).bind(...params).all()

    return c.json({ recalls: rs.results || [] })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

// POST /api/recalls - Crea nuovo recall manualmente
app.post('/api/recalls', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)
    const b: any = await c.req.json()

    if (!b.customer_id || !b.data_richiamo) {
      return c.json({ error: 'Campi obbligatori mancanti' }, 400)
    }

    // Solo admin o Sandra possono creare recall
    if (role === 'venditore') {
      const username = await c.env.DB
        .prepare('SELECT username FROM users WHERE id = ?')
        .bind(uid)
        .first<{ username: string }>();
      
      if (username?.username !== SANDRA_USERNAME) {
        return c.json({ error: 'Non autorizzato' }, 403);
      }
    }

    // Di default assegna a Sandra
    let assignedTo = b.assigned_to || uid;
    if (!assignedTo) {
      const sandraId = await getUserIdByUsername(c.env.DB, SANDRA_USERNAME);
      assignedTo = sandraId || uid;
    }

    const res: any = await c.env.DB.prepare(`
      INSERT INTO recalls (customer_id, appointment_id, assigned_to, data_richiamo, motivo, note, stato)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      b.customer_id,
      b.appointment_id || null,
      assignedTo,
      b.data_richiamo,
      b.motivo || null,
      b.note || null,
      b.stato || 'pending'
    ).run()

    return c.json({ success: true, id: res.meta?.last_row_id })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

// PATCH /api/recalls/:id - Aggiorna stato e note recall
app.patch('/api/recalls/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)
    const apptId = c.req.param('id')
    const body: any = await c.req.json()

    // Solo admin o Sandra possono aggiornare recall
    if (role === 'venditore') {
      const userInfo = await c.env.DB
        .prepare('SELECT username FROM users WHERE id = ?')
        .bind(uid)
        .first<{ username: string }>();
      
      if (!userInfo || userInfo.username.toLowerCase() !== 'sandra') {
        return c.json({ error: 'Non autorizzato' }, 403);
      }
    }

    const fields: string[] = []
    const vals: any[] = []

    if ('stato_recall' in body) {
      fields.push('stato_recall = ?')
      vals.push(body.stato_recall || null)
    }

    if ('note_recall' in body) {
      fields.push('note_recall = ?')
      vals.push(body.note_recall || null)
    }

    if ('esito_vendita' in body) {
      fields.push('esito_vendita = ?')
      vals.push(body.esito_vendita)
    }

    if (fields.length === 0) {
      return c.json({ error: 'Nessun campo da aggiornare' }, 400)
    }

    fields.push('updated_at = CURRENT_TIMESTAMP')
    vals.push(apptId)

    await c.env.DB.prepare(`
      UPDATE appointments
      SET ${fields.join(', ')}
      WHERE id = ?
    `).bind(...vals).run()

    return c.json({ success: true })
  } catch (e: any) {
    console.error('❌ Errore aggiornamento recall:', e)
    return c.json({ error: 'Errore interno: ' + (e?.message || '') }, 500)
  }
})


// DELETE /api/recalls/:id - Elimina recall
app.delete('/api/recalls/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)
    const id = c.req.param('id')

    // Solo admin può eliminare recall
    if (role !== 'admin') {
      return c.json({ error: 'Non autorizzato' }, 403);
    }

    await c.env.DB.prepare('DELETE FROM recalls WHERE id = ?').bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

/* ---------------- SALES ---------------- */
app.get('/api/sales', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role')
    const uid = c.req.header('user-id')

    let q = `
      SELECT s.*, 
             c.nome as customer_nome, 
             c.cognome as customer_cognome,
             u.nome_completo as venditore_nome
      FROM sales s
      LEFT JOIN customers c ON s.customer_id = c.id
      LEFT JOIN users u ON s.user_id = u.id
    `

    const p: any[] = []
    if (role === 'venditore') {
      q += ' WHERE s.user_id = ?'
      p.push(uid)
    }

    q += ' ORDER BY s.created_at DESC'

    const rows = await c.env.DB.prepare(q).bind(...p).all()
    return c.json({ success: true, sales: rows.results })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

app.get('/api/sales/by-customer/:customerId', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const customerId = c.req.param('customerId')

    const sales = await c.env.DB.prepare(`
      SELECT s.*, o.id as order_id, o.stato as order_stato
      FROM sales s
      LEFT JOIN orders o ON o.sale_id = s.id
      WHERE s.customer_id = ?
      ORDER BY s.created_at DESC
    `).bind(customerId).all()

    return c.json({ success: true, sales: sales.results })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

/* ---------------- RILIEVI ---------------- */
app.get('/api/rilievi', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)

    // Solo admin, Cosimo e Giada possono accedere
    const hasRilievi = await hasScope(c.env.DB, uid, 'rilievi')
    if (role !== 'admin' && !hasRilievi) {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    const rs = await c.env.DB.prepare(`
  SELECT r.id, r.customer_id, r.stato, r.data_rilievo, r.ora_rilievo, 
         r.tecnico_id, r.note, r.allegato, r.allegato_nome, r.allegato_tipo,
         r.data_completamento, r.created_at, r.updated_at,
         r.prodotti_quantita,
         (c.nome || ' ' || c.cognome) AS cliente,
         c.telefono AS cliente_telefono,
         CASE WHEN c.cantiere_diverso = 1 THEN c.cantiere_indirizzo ELSE c.indirizzo END AS cliente_indirizzo,
         c.provincia AS provincia,
         c.prodotti_venduti AS prodotti_venduti,
         c.note AS cliente_note,
         u.nome_completo AS tecnico_nome,
         s.data_vendita AS data_contratto
  FROM rilievi r
  LEFT JOIN customers c ON c.id = r.customer_id
  LEFT JOIN users u ON u.id = r.tecnico_id
  LEFT JOIN sales s ON s.customer_id = r.customer_id
  ORDER BY 
    s.data_vendita DESC NULLS LAST,
    CASE r.stato 
      WHEN 'da programmare' THEN 1
      WHEN 'rilievo programmato' THEN 2
      WHEN 'rilievo eseguito' THEN 3
    END,
    r.data_rilievo ASC,
    r.created_at DESC
`).all()

    // 🔧 FIX: Carica prodotti_venduti per ogni rilievo
    const rilieviWithProducts = await Promise.all(
      (rs.results || []).map(async (rilievo: any) => {
        if (rilievo.customer_id) {
          const customer = await c.env.DB.prepare(`
            SELECT id, nome, cognome, prodotti_venduti FROM customers WHERE id = ?
          `).bind(rilievo.customer_id).first<{ id: number; nome: string; cognome: string; prodotti_venduti: string | null }>();
          
          console.log(`🔍 [GET /api/rilievi] Cliente ${customer?.nome} ${customer?.cognome} (ID: ${customer?.id}):`, customer?.prodotti_venduti);
          
          // 🔧 FIX: Ignora "null" come stringa E null vero
          if (customer?.prodotti_venduti && customer.prodotti_venduti !== 'null' && customer.prodotti_venduti !== null) {
            rilievo.prodotti_venduti = customer.prodotti_venduti;
          } else {
            // Imposta esplicitamente a null per evitare stringhe 'null'
            rilievo.prodotti_venduti = null;
          }
        }
        return rilievo;
      })
    );

    // 🔍 DEBUG: Log finale prima di restituire
    console.log('🔍 [GET /api/rilievi] Rilievi con prodotti:', JSON.stringify(rilieviWithProducts, null, 2))
    
    return c.json({ success: true, rilievi: rilieviWithProducts })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + (e?.message || '') }, 500)
  }
})

app.get('/api/rilievi/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const id = c.req.param('id')
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)

    const hasRilievi = await hasScope(c.env.DB, uid, 'rilievi')
    if (role !== 'admin' && !hasRilievi) {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    const rilievo = await c.env.DB.prepare(`
      SELECT r.*,
             (c.nome || ' ' || c.cognome) AS cliente,
             c.telefono AS cliente_telefono,
             c.email AS cliente_email,
             CASE WHEN c.cantiere_diverso = 1 THEN c.cantiere_indirizzo ELSE c.indirizzo END AS cliente_indirizzo,
             c.note AS cliente_note,
             u.nome_completo AS tecnico_nome
      FROM rilievi r
      LEFT JOIN customers c ON c.id = r.customer_id
      LEFT JOIN users u ON u.id = r.tecnico_id
      WHERE r.id = ?
    `).bind(id).first()

    if (!rilievo) {
      return c.json({ error: 'Rilievo non trovato' }, 404)
    }

    // Carica preventivi del cliente
    const preventivi = await c.env.DB.prepare(`
      SELECT id, stato, created_at
      FROM preventivi
      WHERE customer_id = ?
      ORDER BY created_at DESC
    `).bind((rilievo as any).customer_id).all()

    return c.json({ 
      success: true, 
      rilievo, 
      preventivi: preventivi.results || [] 
    })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + (e?.message || '') }, 500)
  }
})

app.put('/api/rilievi/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const id = c.req.param('id')
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)

    const hasRilievi = await hasScope(c.env.DB, uid, 'rilievi')
    if (role !== 'admin' && !hasRilievi) {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    const b: any = await c.req.json()

    // Validazione: non si può passare a "rilievo eseguito" senza allegato
    if (b.stato === 'rilievo eseguito') {
      // 🔧 Controlla se esiste allegato nella tabella attachments
      const rilievo = await c.env.DB.prepare(`SELECT customer_id FROM rilievi WHERE id = ?`)
        .bind(id).first<{ customer_id: number }>()
      
      if (!rilievo) {
        return c.json({ error: 'Rilievo non trovato' }, 404)
      }

      const hasAttachment = await c.env.DB.prepare(`
        SELECT COUNT(*) as count FROM attachments 
        WHERE customer_id = ? AND tipo_allegato = 'rilievo'
      `).bind(rilievo.customer_id).first<{ count: number }>()
      
      if (!hasAttachment?.count && !b.allegato) {
        return c.json({ error: 'Allegato obbligatorio per completare il rilievo' }, 400)
      }

      // Imposta data completamento
      b.data_completamento = new Date().toISOString()
    }

    const fields: string[] = []
    const vals: any[] = []

    for (const k of ['stato', 'data_rilievo', 'ora_rilievo', 'tecnico_id', 'note', 'tempo_stimato_montaggio', 'data_completamento', 'prodotti_quantita']) {
      if (k in b) {
        fields.push(`${k} = ?`)
        vals.push(b[k])
      }
    }

    // 🔧 NUOVO: Salva allegato su Cloudflare R2 (supporta file fino a 5GB)
if (b.allegato !== undefined && b.allegato && b.allegato_nome) {
  // Validazione dimensione - R2 supporta fino a 5GB
  const base64Size = b.allegato.length * 0.75
  const maxSize = 5 * 1024 * 1024 * 1024 // 5GB
  
  if (base64Size > maxSize) {
    return c.json({ 
      error: 'File troppo grande. Massimo 5GB',
      size: Math.round(base64Size / 1024 / 1024) + 'MB',
      max_gb: 5
    }, 400)
  }

  // Ottieni customer_id dal rilievo
  const rilievo = await c.env.DB.prepare(`
    SELECT customer_id FROM rilievi WHERE id = ?
  `).bind(id).first<{ customer_id: number }>()

  if (!rilievo) {
    return c.json({ error: 'Rilievo non trovato' }, 404)
  }

  try {
    // Converti base64 a buffer
    const base64Data = b.allegato.split(',')[1] || b.allegato
    const buffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))

    // Genera chiave univoca per R2
    const timestamp = Date.now()
    const r2Key = `rilievi/${rilievo.customer_id}/${timestamp}-${b.allegato_nome}`

    // Salva su R2
    await c.env.R2.put(r2Key, buffer, {
      httpMetadata: {
        contentType: b.allegato_tipo || 'application/octet-stream'
      },
      customMetadata: {
        customer_id: String(rilievo.customer_id),
        rilievo_id: String(id),
        original_filename: b.allegato_nome
      }
    })

    // Elimina vecchi allegati dal database (solo metadati)
    await c.env.DB.prepare(`
      DELETE FROM attachments 
      WHERE customer_id = ? AND tipo_allegato = 'rilievo'
    `).bind(rilievo.customer_id).run()

    // Salva SOLO metadati nel database (non il file)
    await c.env.DB.prepare(`
      INSERT INTO attachments (
        customer_id, tipo_allegato, filename, mime_type, size, data_base64
      ) VALUES (?, 'rilievo', ?, ?, ?, ?)
    `).bind(
      rilievo.customer_id,
      b.allegato_nome,
      b.allegato_tipo || 'application/octet-stream',
      Math.round(base64Size),
      r2Key  // Salva la chiave R2 invece del file
    ).run()

    console.log(`✅ File salvato su R2: ${r2Key}`)
  } catch (r2Error: any) {
    console.error('❌ Errore salvataggio R2:', r2Error)
    return c.json({ 
      error: 'Errore salvataggio file su storage', 
      details: r2Error.message 
    }, 500)
  }
}

    fields.push('updated_at = CURRENT_TIMESTAMP')
    vals.push(id)

    if (fields.length) {
      // 🔧 CORREZIONE: Usa try-catch per catturare errori SQLite specifici
      try {
        await c.env.DB.prepare(`UPDATE rilievi SET ${fields.join(', ')} WHERE id = ?`)
          .bind(...vals).run()
      } catch (sqlError: any) {
        console.error('[RILIEVI UPDATE ERROR]', sqlError)
        
        // Errori comuni SQLite
        if (sqlError.message?.includes('too large')) {
          return c.json({ error: 'File troppo grande per il database' }, 400)
        }
        if (sqlError.message?.includes('BLOB')) {
          return c.json({ error: 'Formato file non valido' }, 400)
        }
        
        throw sqlError // Rilancia se non è un errore noto
      }
    }

    // 📅 COPIA/AGGIORNA NEL CALENDARIO MONTAGGI
    if (b.data_rilievo) {
      console.log('🔵 AGGIORNO CALENDARIO MONTAGGI per rilievo ID:', id);
      
      try {
        // Controlla se esiste già un montaggio per questo rilievo
        const existing = await c.env.DB.prepare(`
          SELECT id FROM montaggi WHERE note LIKE ?
        `).bind(`%Rilievo ID: ${id}%`).first();
        
        const dataMontaggio = b.data_rilievo; // YYYY-MM-DD
        const oraMontaggio = b.ora_rilievo || '00:00:00';
        
        // Ottieni info cliente
        const rilievoData = await c.env.DB.prepare(`
          SELECT r.customer_id, c.nome, c.cognome 
          FROM rilievi r 
          LEFT JOIN customers c ON c.id = r.customer_id 
          WHERE r.id = ?
        `).bind(id).first();
        
        const clienteNome = rilievoData ? `${rilievoData.nome || ''} ${rilievoData.cognome || ''}`.trim() : 'Cliente';
        
        if (existing) {
          // Aggiorna montaggio esistente
          await c.env.DB.prepare(`
            UPDATE montaggi 
            SET data_montaggio = ?, ora_montaggio = ?, stato = ?, note = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).bind(
            dataMontaggio,
            oraMontaggio,
            b.stato === 'rilievo eseguito' ? 'completato' : 'programmato',
            `🔵 Rilievo: ${clienteNome} - Rilievo ID: ${id}`,
            existing.id
          ).run();
          
          console.log('✅ Montaggio aggiornato nel calendario');
        } else {
          // Crea nuovo montaggio
          await c.env.DB.prepare(`
            INSERT INTO montaggi (
              order_id, customer_id, product_type, data_montaggio, ora_montaggio, 
              montatori, stato, note, priorita, created_at
            ) VALUES (NULL, ?, 'rilievo', ?, ?, ?, ?, ?, 'normale', CURRENT_TIMESTAMP)
          `).bind(
            rilievoData?.customer_id || 0,
            dataMontaggio,
            oraMontaggio,
            clienteNome,
            b.stato === 'rilievo eseguito' ? 'completato' : 'programmato',
            `🔵 Rilievo: ${clienteNome} - Rilievo ID: ${id}`
          ).run();
          
          console.log('✅ Nuovo montaggio creato nel calendario');
        }
      } catch (e) {
        console.error('⚠️ Errore sincronizzazione calendario montaggi:', e);
      }
    }

    return c.json({ success: true })
  } catch (e: any) {
    console.error('[RILIEVI ERROR]', e)
    return c.json({ 
      error: 'Errore: ' + (e?.message || 'Errore interno del server'),
      details: e.message 
    }, 500)
  }
})

app.get('/api/rilievi/:id/allegato', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const id = c.req.param('id')

    // 🔧 Leggi metadati dal database
    const rilievo = await c.env.DB.prepare(`
      SELECT customer_id FROM rilievi WHERE id = ?
    `).bind(id).first<{ customer_id: number }>()

    if (!rilievo) {
      return c.json({ error: 'Rilievo non trovato' }, 404)
    }

    const row = await c.env.DB.prepare(`
      SELECT data_base64, filename, mime_type
      FROM attachments
      WHERE customer_id = ? AND tipo_allegato = 'rilievo'
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(rilievo.customer_id).first<{ data_base64: string; filename: string; mime_type: string }>()

    if (!row || !row.data_base64) {
      return c.json({ error: 'Allegato non trovato' }, 404)
    }

    // 🔧 Il campo data_base64 contiene la chiave R2, non il file
    const r2Key = row.data_base64

    try {
      // Leggi file da R2
      const object = await c.env.R2.get(r2Key)

      if (!object) {
        return c.json({ error: 'File non trovato su storage' }, 404)
      }

      // Stream del file direttamente da R2
      return new Response(object.body, {
        headers: {
          'Content-Type': row.mime_type || 'application/octet-stream',
          'Content-Disposition': `inline; filename="${(row.filename || 'rilievo').replace(/"/g, '')}"`,
          'Cache-Control': 'private, max-age=0',
          'Content-Length': String(object.size)
        },
      })
    } catch (r2Error: any) {
      console.error('❌ Errore lettura R2:', r2Error)
      return c.json({ 
        error: 'Errore lettura file da storage', 
        details: r2Error.message 
      }, 500)
    }
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + (e?.message || '') }, 500)
  }
})

/* ---------------- ORDERS (GESTIONE ORDINI) ---------------- */
    app.get('/api/orders', async (c) => {
  try {
    console.log('[ORDERS] Starting...')

    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    // ✅ CORREZIONE: Permetti accesso ad admin O utenti con scope 'orders'
    const hasOrders = await hasScope(c.env.DB, uid, 'orders');
    if (role !== 'admin' && !hasOrders) {
      console.log('[ORDERS] Not authorized, denying access')
      return c.json({ error: 'Accesso negato' }, 403)
    }

    console.log('[ORDERS] Initializing DB...')
    await ensureInit(c.env.DB)

    console.log('[ORDERS] Executing main query...')
  const rs = await c.env.DB.prepare(`
  SELECT o.*, 
         (cu.nome || ' ' || cu.cognome) AS cliente,
         cu.telefono AS cliente_telefono,
         CASE WHEN cu.cantiere_diverso = 1 THEN cu.cantiere_indirizzo ELSE cu.indirizzo END AS cliente_indirizzo,
         CASE WHEN cu.cantiere_diverso = 1 THEN cu.cantiere_citta ELSE cu.citta END AS cliente_citta,
         CASE WHEN cu.cantiere_diverso = 1 THEN cu.cantiere_provincia ELSE cu.provincia END AS cliente_provincia,
         COALESCE(cu.numero_contratto, s.numero_contratto) AS numero_contratto,
         s.totale AS importo_vendita,
         s.numero_ordine,
         s.data_vendita AS data_contratto,
         u.nome_completo AS venditore
  FROM orders o
  LEFT JOIN customers cu ON cu.id = o.customer_id
  LEFT JOIN sales s ON s.id = o.sale_id
  LEFT JOIN users u ON u.id = s.user_id
  ORDER BY s.data_vendita DESC NULLS LAST, o.created_at DESC
`).all()

    console.log('[ORDERS] Query results:', rs.results?.length || 0, 'orders found')
    const ordersRaw = rs.results || []
    const itemsByOrder: Record<number, any[]> = {}

    if (ordersRaw.length > 0) {
      const ids = ordersRaw.map((r: any) => r.id).filter(id => id != null)
      console.log('[ORDERS] Order IDs:', ids)

      if (ids.length > 0) {
        console.log('[ORDERS] Fetching items for', ids.length, 'orders...')
        const placeholders = ids.map(() => '?').join(',')

        try {
          const ir = await c.env.DB.prepare(`
             SELECT id, order_id, product_type, selezionato, costo, data_prevista, data_arrivo, fornitore, quantita
            FROM order_items
            WHERE order_id IN (${placeholders})
            ORDER BY product_type
          `).bind(...ids).all()

          console.log('[ORDERS] Found', ir.results?.length || 0, 'items')

          for (const item of ir.results || []) {
            const orderId = (item as any).order_id
            if (!itemsByOrder[orderId]) {
              itemsByOrder[orderId] = []
            }
            itemsByOrder[orderId].push(item)
          }

          console.log('[ORDERS] Items grouped by order')
        } catch (itemError: any) {
          console.error('[ORDERS] Error fetching items:', itemError.message)
          console.error('[ORDERS] Items query failed, continuing without items')
        }
      } else {
        console.log('[ORDERS] No valid order IDs to fetch items for')
      }
    } else {
      console.log('[ORDERS] No orders found, skipping items fetch')
    }

    // Fallback: se qualche ordine non ha items, faccio seeding e rileggo
    for (const o of ordersRaw) {
      const oid = (o as any).id
      const items = itemsByOrder[oid] || []

      if (!items.length) {
        await seedOrderItemsIfMissing(c.env.DB, oid)
       const r2 = await c.env.DB.prepare(`
          SELECT id, order_id, product_type, selezionato, costo, data_prevista, data_arrivo, fornitore, quantita
          FROM order_items
          WHERE order_id = ?
          ORDER BY product_type
        `).bind(oid).all()

        itemsByOrder[oid] = r2.results || []
      }
    }

   const orders = ordersRaw.map((o: any) => {
      const items = itemsByOrder[o.id] || []
      
      // 🔄 Calcola stato dinamico basato sui prodotti
      let statoCalcolato = o.stato
      const selectedItems = items.filter((i: any) => i.selezionato)
      
      if (selectedItems.length > 0) {
        const allArrived = selectedItems.every((i: any) => i.data_arrivo)
        const someArrived = selectedItems.some((i: any) => i.data_arrivo)
        
        if (allArrived) {
          statoCalcolato = 'da_programmare'
        } else if (someArrived) {
          statoCalcolato = 'in_preparazione'
        } else {
          statoCalcolato = 'in_preparazione'
        }
      }
      
      return {
        ...o,
        stato: statoCalcolato,
        items
      }
    })

    console.log('[ORDERS] Returning', orders.length, 'orders with items')
    return c.json({ success: true, orders })
  } catch (e: any) {
    console.error('[ORDERS ERROR] Full error:', e)
    console.error('[ORDERS ERROR] Message:', e.message)
    console.error('[ORDERS ERROR] Stack:', e.stack)
    return c.json({
      error: 'Errore interno del server: ' + (e?.message || ''),
      details: e.message,
      stack: e.stack
    }, 500)
  }
})

app.get('/api/orders/:id/products', async (c) => {
  try {
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    // ✅ CORREZIONE: Permetti accesso ad admin O utenti con scope 'orders'
    const hasOrders = await hasScope(c.env.DB, uid, 'orders');
    if (role !== 'admin' && !hasOrders) {
      return c.json({ error: 'Accesso negato' }, 403);
    }

    await ensureInit(c.env.DB)
    const orderId = c.req.param('id')

    const items = await c.env.DB.prepare(`
      SELECT oi.*, o.customer_id, (cu.nome || ' ' || cu.cognome) AS cliente
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN customers cu ON cu.id = o.customer_id
      WHERE oi.order_id = ?
      ORDER BY oi.product_type
    `).bind(orderId).all()

    return c.json({ success: true, items: items.results })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

// ============ AGGIUNGI QUESTI DUE ENDPOINT ============

// 1️⃣ Aggiorna stato ordine (per bottone "Completa")
app.put('/api/orders/:id/stato', async (c) => {
  try {
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    const hasOrders = await hasScope(c.env.DB, uid, 'orders');
    if (role !== 'admin' && !hasOrders) {
      return c.json({ error: 'Accesso negato' }, 403);
    }

    await ensureInit(c.env.DB)
    const orderId = c.req.param('id')
    const { stato } = await c.req.json() as { stato: string }

    // Valida stato
    const statiValidi = ['in_preparazione', 'da_programmare', 'completato'];
    if (!statiValidi.includes(stato)) {
      return c.json({ error: 'Stato non valido' }, 400);
    }

    await c.env.DB.prepare(`
      UPDATE orders
      SET stato = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(stato, orderId).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

// 2️⃣ Elimina ordine (per bottone "Elimina")
app.delete('/api/orders/:id', async (c) => {
  try {
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    const hasOrders = await hasScope(c.env.DB, uid, 'orders');
    if (role !== 'admin' && !hasOrders) {
      return c.json({ error: 'Accesso negato' }, 403);
    }

    await ensureInit(c.env.DB)
    const orderId = c.req.param('id')

    // Elimina prima gli items dell'ordine (per evitare errori di foreign key)
    await c.env.DB.prepare(`
      DELETE FROM order_items WHERE order_id = ?
    `).bind(orderId).run()

    // Elimina i montaggi associati
    await c.env.DB.prepare(`
      DELETE FROM montaggi WHERE order_id = ?
    `).bind(orderId).run()

    // Elimina l'ordine
    await c.env.DB.prepare(`
      DELETE FROM orders WHERE id = ?
    `).bind(orderId).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

// ============ FINE NUOVI ENDPOINT ============

app.put('/api/orders/:id/products', async (c) => {
  try {
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    // ✅ CORREZIONE: Permetti accesso ad admin O utenti con scope 'orders'
    const hasOrders = await hasScope(c.env.DB, uid, 'orders');
    if (role !== 'admin' && !hasOrders) {
      return c.json({ error: 'Accesso negato' }, 403);
    }

    await ensureInit(c.env.DB)
    const orderId = c.req.param('id')
    const { products } = await c.req.json() as { products: any[] }

    for (const product of products) {
     await c.env.DB.prepare(`
        UPDATE order_items
        SET selezionato = ?, costo = ?, data_prevista = ?, data_arrivo = ?, fornitore = ?, quantita = ?, updated_at = CURRENT_TIMESTAMP
        WHERE order_id = ? AND product_type = ?
      `).bind(
        product.selezionato ? 1 : 0,
        product.costo || 0,
        product.data_prevista || null,
        product.data_arrivo || null,
        product.fornitore || null,
        product.quantita || 1,
        orderId,
        product.product_type
      ).run()

      if (product.data_arrivo && product.selezionato) {
        const order = await c.env.DB.prepare(`
          SELECT customer_id FROM orders WHERE id = ?
        `).bind(orderId).first<{ customer_id: number }>()

        if (order) {
          const existingMontaggio = await c.env.DB.prepare(`
            SELECT id FROM montaggi WHERE order_id = ? AND product_type = ?
          `).bind(orderId, product.product_type).first()

          if (!existingMontaggio) {
            // 🔍 Controlla se tutta la merce selezionata è arrivata
            const merceCheck = await c.env.DB.prepare(`
              SELECT COUNT(*) as total,
                     SUM(CASE WHEN data_arrivo IS NOT NULL THEN 1 ELSE 0 END) as arrived
              FROM order_items
              WHERE order_id = ? AND selezionato = 1
            `).bind(orderId).first<{ total: number, arrived: number }>()
            
            const tuttoArrivato = merceCheck && merceCheck.total === merceCheck.arrived
            const statoIniziale = tuttoArrivato ? 'da_programmare' : 'attesa_merci'
            
            await c.env.DB.prepare(`
              INSERT INTO montaggi (
                order_id, customer_id, product_type, stato, priorita, created_at
              ) VALUES (?, ?, ?, ?, 'normale', CURRENT_TIMESTAMP)
            `).bind(orderId, order.customer_id, product.product_type, statoIniziale).run()
          }
        }
      }
    }
    
    // 🔄 Aggiorna montaggi in attesa_merci se ora è tutto arrivato
    const finalCheck = await c.env.DB.prepare(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN data_arrivo IS NOT NULL THEN 1 ELSE 0 END) as arrived
      FROM order_items
      WHERE order_id = ? AND selezionato = 1
    `).bind(orderId).first<{ total: number, arrived: number }>()
    
if (finalCheck && finalCheck.total > 0) {
      if (finalCheck.total === finalCheck.arrived) {
        // Tutto arrivato → da_programmare (solo se non è già programmato/completato)
        await c.env.DB.prepare(`
          UPDATE montaggi
          SET stato = 'da_programmare'
          WHERE order_id = ? AND stato IN ('attesa_merci', 'da_programmare')
        `).bind(orderId).run()
      } else {
        // Qualcosa manca → attesa_merci (solo se non è già programmato/completato)
        await c.env.DB.prepare(`
          UPDATE montaggi
          SET stato = 'attesa_merci'
          WHERE order_id = ? AND stato IN ('attesa_merci', 'da_programmare')
        `).bind(orderId).run()
      }
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

app.put('/api/order-items/:id', async (c) => {
  try {
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    // ✅ CORREZIONE: Permetti accesso ad admin O utenti con scope 'orders'
    const hasOrders = await hasScope(c.env.DB, uid, 'orders');
    if (role !== 'admin' && !hasOrders) {
      return c.json({ error: 'Accesso negato' }, 403);
    }

    await ensureInit(c.env.DB)
    const id = c.req.param('id')
    const body: any = await c.req.json()

    const current = await c.env.DB.prepare(`
      SELECT oi.*, o.customer_id
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE oi.id = ?
    `).bind(id).first<any>()

    if (!current) return c.json({ error: 'Elemento non trovato' }, 404)

    if (body.data_arrivo && !current.data_arrivo && body.selezionato) {
      await c.env.DB.prepare(`
        INSERT INTO montaggi (
          order_id, customer_id, product_type, stato, priorita, created_at
        ) VALUES (?, ?, ?, 'da_programmare', 'normale', CURRENT_TIMESTAMP)
      `).bind(current.order_id, current.customer_id, current.product_type).run()
    }

    await c.env.DB.prepare(`
      UPDATE order_items
      SET selezionato = ?, costo = ?, data_prevista = ?, data_arrivo = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(
      body.selezionato ? 1 : 0,
      body.costo || 0,
      body.data_prevista || null,
      body.data_arrivo || null,
      id
    ).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

app.delete('/api/sales/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role')
    const id = Number(c.req.param('id'))
    
    console.log('Eliminazione vendita ID:', id, 'Role:', role)

    if (role !== 'admin') {
      return c.json({ error: 'Accesso negato: solo admin' }, 403)
    }

    // Verifica che la vendita esista
    const sale = await c.env.DB.prepare(`SELECT id FROM sales WHERE id = ?`).bind(id).first()
    if (!sale) {
      return c.json({ error: 'Vendita non trovata' }, 404)
    }

    // ELIMINAZIONE IN CASCATA (nell'ordine corretto per evitare errori di foreign key)
    
    // 1. Elimina montaggi collegati agli ordini di questa vendita
    await c.env.DB.prepare(`
      DELETE FROM montaggi 
      WHERE order_id IN (SELECT id FROM orders WHERE sale_id = ?)
    `).bind(id).run()

    // 2. Elimina order_items collegati agli ordini di questa vendita
    await c.env.DB.prepare(`
      DELETE FROM order_items 
      WHERE order_id IN (SELECT id FROM orders WHERE sale_id = ?)
    `).bind(id).run()

    // 3. Elimina orders collegati a questa vendita
    await c.env.DB.prepare(`DELETE FROM orders WHERE sale_id = ?`).bind(id).run()

    // 4. Elimina sale_items collegati a questa vendita (se esistono)
    await c.env.DB.prepare(`DELETE FROM sale_items WHERE sale_id = ?`).bind(id).run()

    // 5. Infine elimina la vendita stessa
    await c.env.DB.prepare(`DELETE FROM sales WHERE id = ?`).bind(id).run()

    console.log('Vendita eliminata con successo:', id)
    return c.json({ success: true, message: 'Vendita eliminata con successo' })
    
  } catch (error: any) {
    console.error('Errore eliminazione vendita:', error)
    return c.json({ error: `Errore interno del server: ${error.message}` }, 500)
  }
})

/* ---------------- TROVA E ELIMINA DOPPIONI ---------------- */
app.get('/api/sales/duplicates', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)
    
    const hasOrders = await hasScope(c.env.DB, uid, 'orders')
    if (role !== 'admin' && !hasOrders) {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    // Trova clienti con più vendite/ordini
    const duplicates = await c.env.DB.prepare(`
      SELECT 
        c.id as customer_id,
        c.nome || ' ' || c.cognome as cliente,
        c.telefono,
        COUNT(s.id) as num_vendite,
        GROUP_CONCAT(s.id) as sale_ids,
        GROUP_CONCAT(s.numero_ordine) as numeri_ordine,
        GROUP_CONCAT(s.totale) as importi
      FROM customers c
      JOIN sales s ON s.customer_id = c.id
      GROUP BY c.id
      HAVING COUNT(s.id) > 1
      ORDER BY num_vendite DESC, c.cognome
    `).all()

    return c.json({ 
      success: true, 
      duplicates: duplicates.results || [] 
    })
  } catch (e: any) {
    console.error('[DUPLICATES ERROR]', e)
    return c.json({ error: 'Errore: ' + (e?.message || '') }, 500)
  }
})

app.delete('/api/sales/:id/force', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)
    const id = Number(c.req.param('id'))
    
    const hasOrders = await hasScope(c.env.DB, uid, 'orders')
    if (role !== 'admin' && !hasOrders) {
      return c.json({ error: 'Accesso negato: solo admin o utenti con scope orders' }, 403)
    }

    console.log('🗑️ Eliminazione forzata vendita ID:', id)

    // Verifica esistenza
    const sale = await c.env.DB.prepare(`SELECT id, customer_id FROM sales WHERE id = ?`).bind(id).first<{ id: number; customer_id: number }>()
    if (!sale) {
      return c.json({ error: 'Vendita non trovata' }, 404)
    }

    // ELIMINAZIONE IN CASCATA (ordine corretto per evitare errori FK)
    // 1. Elimina montaggi
    await c.env.DB.prepare(`
      DELETE FROM montaggi 
      WHERE order_id IN (SELECT id FROM orders WHERE sale_id = ?)
    `).bind(id).run()

    // 2. Elimina order_items
    await c.env.DB.prepare(`
      DELETE FROM order_items 
      WHERE order_id IN (SELECT id FROM orders WHERE sale_id = ?)
    `).bind(id).run()

    // 3. Elimina orders
    await c.env.DB.prepare(`DELETE FROM orders WHERE sale_id = ?`).bind(id).run()

    // 4. Elimina sale_items
    await c.env.DB.prepare(`DELETE FROM sale_items WHERE sale_id = ?`).bind(id).run()

    // 5. Elimina vendita
    await c.env.DB.prepare(`DELETE FROM sales WHERE id = ?`).bind(id).run()

    // 6. Log attività
    await c.env.DB.prepare(`
      INSERT INTO activities (tipo, descrizione, customer_id, user_id, metadata)
      VALUES ('sale_deleted', 'Vendita eliminata (duplicato)', ?, ?, ?)
    `).bind(sale.customer_id, uid, JSON.stringify({ sale_id: id })).run()

    console.log('✅ Vendita eliminata con successo:', id)
    return c.json({ success: true, message: 'Vendita eliminata con successo' })
    
  } catch (error: any) {
    console.error('❌ Errore eliminazione vendita:', error)
    return c.json({ error: `Errore: ${error.message}` }, 500)
  }
})

/* ---------------- MODIFICA VENDITA E ORDINE ---------------- */
app.put('/api/sales/:id/update', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)
    const saleId = Number(c.req.param('id'))
    
    const hasOrders = await hasScope(c.env.DB, uid, 'orders')
    if (role !== 'admin' && !hasOrders) {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    const b: any = await c.req.json()

    // 1. Aggiorna importo vendita
    if (b.totale !== undefined) {
      await c.env.DB.prepare(`
        UPDATE sales 
        SET totale = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).bind(Number(b.totale), saleId).run()
      
      console.log(`✅ Importo vendita ${saleId} aggiornato: €${b.totale}`)
    }

    // 2. Aggiorna prodotti selezionati nell'ordine
    if (b.prodotti_selezionati && Array.isArray(b.prodotti_selezionati)) {
      const order = await c.env.DB.prepare(`
        SELECT id, customer_id FROM orders WHERE sale_id = ? LIMIT 1
      `).bind(saleId).first<{ id: number; customer_id: number }>()

      if (order) {
        const orderId = order.id
        const customerId = order.customer_id

        // Aggiorna order_items: seleziona solo quelli richiesti
        const productTypes = [
          'infissi', 'tapparelle', 'zanzariere', 'scuri',
          'porta_blindata', 'porte_interne', 'veneziane', 'pergole', 'cassonetti'
        ]

        for (const productType of productTypes) {
          const selezionato = b.prodotti_selezionati.includes(productType) ? 1 : 0
          const oggi = new Date().toISOString().split('T')[0]

          // Verifica se esiste già
          const existing = await c.env.DB.prepare(`
            SELECT id FROM order_items WHERE order_id = ? AND product_type = ?
          `).bind(orderId, productType).first()

          if (existing) {
            // Aggiorna esistente
            await c.env.DB.prepare(`
              UPDATE order_items 
              SET selezionato = ?, data_arrivo = ?, updated_at = CURRENT_TIMESTAMP
              WHERE order_id = ? AND product_type = ?
            `).bind(selezionato, selezionato ? oggi : null, orderId, productType).run()
          } else {
            // Crea nuovo
            await c.env.DB.prepare(`
              INSERT INTO order_items (order_id, product_type, selezionato, costo, data_prevista, data_arrivo)
              VALUES (?, ?, ?, 0.00, ?, ?)
            `).bind(orderId, productType, selezionato, selezionato ? oggi : null, selezionato ? oggi : null).run()
          }
        }

        // Crea montaggi per nuovi prodotti selezionati (se non esistono già)
        for (const prodotto of b.prodotti_selezionati) {
          const existingMontaggio = await c.env.DB.prepare(`
            SELECT id FROM montaggi WHERE order_id = ? AND product_type = ?
          `).bind(orderId, prodotto).first()

          if (!existingMontaggio) {
            await c.env.DB.prepare(`
              INSERT INTO montaggi (order_id, customer_id, product_type, stato, priorita)
              VALUES (?, ?, ?, 'da_programmare', 'normale')
            `).bind(orderId, customerId, prodotto).run()
            
            console.log(`✅ Creato montaggio per: ${prodotto}`)
          }
        }

        // Elimina montaggi per prodotti deselezionati
        if (b.prodotti_selezionati.length > 0) {
          const placeholders = b.prodotti_selezionati.map(() => '?').join(',')
          await c.env.DB.prepare(`
            DELETE FROM montaggi 
            WHERE order_id = ? 
            AND product_type NOT IN (${placeholders})
          `).bind(orderId, ...b.prodotti_selezionati).run()
        }

        console.log(`✅ Prodotti ordine ${orderId} aggiornati`)
      }
    }

    // 3. Log attività
    const sale = await c.env.DB.prepare(`SELECT customer_id FROM sales WHERE id = ?`).bind(saleId).first<{ customer_id: number }>()
    if (sale) {
      await c.env.DB.prepare(`
        INSERT INTO activities (tipo, descrizione, customer_id, user_id, metadata)
        VALUES ('sale_updated', 'Vendita/Ordine modificato da Ordini', ?, ?, ?)
      `).bind(sale.customer_id, uid, JSON.stringify({ 
        sale_id: saleId, 
        totale: b.totale,
        prodotti: b.prodotti_selezionati 
      })).run()
    }

    return c.json({ success: true, message: 'Vendita e ordine aggiornati' })
  } catch (e: any) {
    console.error('❌ Errore aggiornamento vendita:', e)
    return c.json({ error: 'Errore: ' + (e?.message || '') }, 500)
  }
})

/* ---------------- MODIFICA VENDITA E ORDINE ---------------- */
app.put('/api/sales/:id/update', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)
    const saleId = Number(c.req.param('id'))
    
    const hasOrders = await hasScope(c.env.DB, uid, 'orders')
    if (role !== 'admin' && !hasOrders) {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    const b: any = await c.req.json()

    // 1. Aggiorna importo vendita
    if (b.totale !== undefined) {
      await c.env.DB.prepare(`
        UPDATE sales 
        SET totale = ?, updated_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).bind(Number(b.totale), saleId).run()
      
      console.log(`✅ Importo vendita ${saleId} aggiornato: €${b.totale}`)
    }

    // 2. Aggiorna prodotti selezionati nell'ordine
    if (b.prodotti_selezionati && Array.isArray(b.prodotti_selezionati)) {
      const order = await c.env.DB.prepare(`
        SELECT id, customer_id FROM orders WHERE sale_id = ? LIMIT 1
      `).bind(saleId).first<{ id: number; customer_id: number }>()

      if (order) {
        const orderId = order.id
        const customerId = order.customer_id

        // Aggiorna order_items: seleziona solo quelli richiesti
          const productTypes = [
      'infissi', 'tapparelle', 'zanzariere', 'scuri',
      'porta_blindata', 'porte_interne', 'veneziane', 'pergole', 'cassonetti'
    ]

        for (const productType of productTypes) {
          const selezionato = b.prodotti_selezionati.includes(productType) ? 1 : 0
          const oggi = new Date().toISOString().split('T')[0]

          // Verifica se esiste già
          const existing = await c.env.DB.prepare(`
            SELECT id FROM order_items WHERE order_id = ? AND product_type = ?
          `).bind(orderId, productType).first()

          if (existing) {
            // Aggiorna esistente
            await c.env.DB.prepare(`
              UPDATE order_items 
              SET selezionato = ?, data_arrivo = ?, updated_at = CURRENT_TIMESTAMP
              WHERE order_id = ? AND product_type = ?
            `).bind(selezionato, selezionato ? oggi : null, orderId, productType).run()
          } else {
            // Crea nuovo
            await c.env.DB.prepare(`
              INSERT INTO order_items (order_id, product_type, selezionato, costo, data_prevista, data_arrivo)
              VALUES (?, ?, ?, 0.00, ?, ?)
            `).bind(orderId, productType, selezionato, selezionato ? oggi : null, selezionato ? oggi : null).run()
          }
        }

        // Crea montaggi per nuovi prodotti selezionati (se non esistono già)
        for (const prodotto of b.prodotti_selezionati) {
          const existingMontaggio = await c.env.DB.prepare(`
            SELECT id FROM montaggi WHERE order_id = ? AND product_type = ?
          `).bind(orderId, prodotto).first()

          if (!existingMontaggio) {
            await c.env.DB.prepare(`
              INSERT INTO montaggi (order_id, customer_id, product_type, stato, priorita)
              VALUES (?, ?, ?, 'da_programmare', 'normale')
            `).bind(orderId, customerId, prodotto).run()
            
            console.log(`✅ Creato montaggio per: ${prodotto}`)
          }
        }

        // Elimina montaggi per prodotti deselezionati
        await c.env.DB.prepare(`
          DELETE FROM montaggi 
          WHERE order_id = ? 
          AND product_type NOT IN (${b.prodotti_selezionati.map(() => '?').join(',')})
        `).bind(orderId, ...b.prodotti_selezionati).run()

        console.log(`✅ Prodotti ordine ${orderId} aggiornati`)
      }
    }

    // 3. Log attività
    const sale = await c.env.DB.prepare(`SELECT customer_id FROM sales WHERE id = ?`).bind(saleId).first<{ customer_id: number }>()
    if (sale) {
      await c.env.DB.prepare(`
        INSERT INTO activities (tipo, descrizione, customer_id, user_id, metadata)
        VALUES ('sale_updated', 'Vendita/Ordine modificato da Ordini', ?, ?, ?)
      `).bind(sale.customer_id, uid, JSON.stringify({ 
        sale_id: saleId, 
        totale: b.totale,
        prodotti: b.prodotti_selezionati 
      })).run()
    }

    return c.json({ success: true, message: 'Vendita e ordine aggiornati' })
  } catch (e: any) {
    console.error('❌ Errore aggiornamento vendita:', e)
    return c.json({ error: 'Errore: ' + (e?.message || '') }, 500)
  }
})

/* ---------------- MONTAGGI (INSTALLAZIONI) ---------------- */

app.get('/api/montaggi', async (c) => {
  try {
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    const hasMontaggi = await hasScope(c.env.DB, uid, 'montaggi');
    if (role !== 'admin' && !hasMontaggi) {
      return c.json({ error: 'Accesso negato' }, 403);
    }

    await ensureInit(c.env.DB)
    
    // 🔍 Filtro numero contratto
    const numeroPreventivo = c.req.query('numero_preventivo') || '';
    const whereClause = numeroPreventivo 
      ? `WHERE s.numero_contratto LIKE '%${numeroPreventivo}%'`
      : '';

    // 🔧 CORREZIONE: Usa MAX per evitare duplicazioni dei campi condivisi
     const montaggi = await c.env.DB.prepare(`
  SELECT MIN(m.id) as id,
         m.customer_id,
         (c.nome || ' ' || c.cognome) AS cliente,
         c.telefono AS cliente_telefono,
         CASE WHEN c.cantiere_diverso = 1 THEN c.cantiere_indirizzo ELSE c.indirizzo END AS cliente_indirizzo,
         CASE WHEN c.cantiere_diverso = 1 THEN c.cantiere_citta ELSE c.citta END AS cliente_citta,
         CASE WHEN c.cantiere_diverso = 1 THEN c.cantiere_provincia ELSE c.provincia END AS cliente_provincia,
         COALESCE(c.numero_contratto, s.numero_contratto) AS numero_contratto,
		 c.numero_contratto AS customer_numero_contratto,
         s.data_vendita AS data_contratto,
         u.nome_completo AS venditore,
         o.id as order_id,
         MAX(m.data_montaggio) as data_montaggio,
         MAX(m.ora_montaggio) as ora_montaggio,
         MAX(m.montatori) as montatori,
         MAX(m.stato) as stato,
         MAX(m.note) as note,
         MAX(m.priorita) as priorita,
		 MAX(r.tempo_stimato_montaggio) as tempo_stimato_montaggio,
		  MAX(m.da_ritornare) as da_ritornare,
         MAX(m.manutenzioni) as manutenzioni,
         GROUP_CONCAT(DISTINCT m.product_type) as prodotti_da_montare,
         COUNT(m.id) as numero_prodotti,
         (SELECT COUNT(*) FROM order_items oi 
          WHERE oi.order_id = o.id AND oi.selezionato = 1 AND oi.data_arrivo IS NOT NULL) as prodotti_arrivati,
         (SELECT COUNT(*) FROM order_items oi 
          WHERE oi.order_id = o.id AND oi.selezionato = 1) as prodotti_totali
  FROM montaggi m
  LEFT JOIN customers c ON c.id = m.customer_id
  LEFT JOIN orders o ON o.id = m.order_id
  LEFT JOIN sales s ON s.id = o.sale_id
  LEFT JOIN users u ON u.id = s.user_id
  LEFT JOIN rilievi r ON r.customer_id = m.customer_id
  ${whereClause}
  GROUP BY m.customer_id, o.id
   ORDER BY 
    CASE MAX(m.stato)
      WHEN 'da_programmare' THEN 1
      WHEN 'programmato' THEN 2
      WHEN 'completato' THEN 3
    END,
    CASE 
      WHEN MAX(m.stato) = 'da_programmare' THEN s.data_vendita
      ELSE MAX(m.data_montaggio)
    END ASC NULLS LAST,
    MIN(m.created_at) DESC
`).all()

    // 🔧 Aggiungi dettagli sui prodotti per ogni montaggio
    const montaggiWithDetails = await Promise.all(
      (montaggi.results || []).map(async (m: any) => {
        if (!m.order_id) return m;
        
        // Recupera i prodotti dell'ordine con stato di arrivo
        const items = await c.env.DB.prepare(`
          SELECT product_type, data_arrivo, selezionato, fornitore, quantita
          FROM order_items
          WHERE order_id = ? AND selezionato = 1
        `).bind(m.order_id).all();
        
          // Separa prodotti arrivati e mancanti con dettagli
        const arrivati: any[] = [];
        const mancanti: any[] = [];
        
        (items.results || []).forEach((item: any) => {
          const prodottoDettaglio = {
            nome: (item.product_type || '').replace(/_/g, ' '),
            fornitore: item.fornitore || '-',
            quantita: item.quantita || 1
          };
          
          if (item.data_arrivo) {
            arrivati.push(prodottoDettaglio);
          } else {
            mancanti.push(prodottoDettaglio);
          }
        });
        
          // 🔧 Auto-imposta stato "attesa_merci" se ci sono prodotti mancanti
        let statoFinale = m.stato;
        
        // Non modificare se già programmato, completato, da_ritornare o manutenzione
        const statiImmodificabili = ['programmato', 'completato', 'da_ritornare', 'manutenzione'];
        
        if (!statiImmodificabili.includes(m.stato)) {
          if (mancanti.length > 0) {
            // Se ci sono prodotti mancanti → SEMPRE attesa_merci
            statoFinale = 'attesa_merci';
          } else if (mancanti.length === 0 && (arrivati.length > 0 || m.prodotti_totali > 0)) {
            // Se tutti i prodotti sono arrivati → SEMPRE da_programmare
            statoFinale = 'da_programmare';
          }
        }
        
		// 🔄 Aggiorna stato nel database se è cambiato
        if (statoFinale !== m.stato && m.order_id) {
          await c.env.DB.prepare(`
            UPDATE montaggi
            SET stato = ?
            WHERE order_id = ?
          `).bind(statoFinale, m.order_id).run();
        }
		
          // Lista completa di tutti i prodotti con dettagli
        const tuttiProdotti = [...arrivati, ...mancanti];
        
        return {
          ...m,
          stato: statoFinale,
          prodotti_arrivati_lista: arrivati,
          prodotti_mancanti_lista: mancanti,
          prodotti_dettagliati: tuttiProdotti
        };
      })
    );
    
    return c.json({ success: true, montaggi: montaggiWithDetails })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

app.post('/api/montaggi', async (c) => {
  try {
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    // ✅ CORREZIONE: Permetti accesso ad admin O utenti con scope 'montaggi'
    const hasMontaggi = await hasScope(c.env.DB, uid, 'montaggi');
    if (role !== 'admin' && !hasMontaggi) {
      return c.json({ error: 'Accesso negato' }, 403);
    }

    await ensureInit(c.env.DB)
    const body: any = await c.req.json()

    if (!body.order_id || !body.customer_id || !body.product_type) {
      return c.json({ error: 'Dati mancanti' }, 400)
    }

    const res: any = await c.env.DB.prepare(`
      INSERT INTO montaggi (
        order_id, customer_id, product_type, data_montaggio, ora_montaggio,
        montatori, stato, note, priorita
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      body.order_id, body.customer_id, body.product_type,
      body.data_montaggio || null, body.ora_montaggio || null,
      body.montatori || null, body.stato || 'da_programmare',
      body.note || null, body.priorita || 'normale'
    ).run()

    return c.json({ success: true, id: res.meta?.last_row_id })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

app.put('/api/montaggi/:id', async (c) => {
  try {
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    // ✅ CORREZIONE: Permetti accesso ad admin O utenti con scope 'montaggi'
    const hasMontaggi = await hasScope(c.env.DB, uid, 'montaggi');
    if (role !== 'admin' && !hasMontaggi) {
      return c.json({ error: 'Accesso negato' }, 403);
    }

    await ensureInit(c.env.DB)
    const id = c.req.param('id')
    const body: any = await c.req.json()

    const fields: string[] = []
    const vals: any[] = []

    for (const k of ['data_montaggio', 'ora_montaggio', 'montatori', 'stato', 'note', 'priorita', 'da_ritornare', 'manutenzioni']) {
      if (k in body) {
        fields.push(`${k}=?`)
        // Converti boolean in integer per SQLite
        const value = (k === 'da_ritornare' || k === 'manutenzioni') 
          ? (body[k] ? 1 : 0) 
          : body[k]
        vals.push(value)
      }
    }

    fields.push('updated_at=CURRENT_TIMESTAMP')
    vals.push(id)

    if (fields.length) {
      await c.env.DB.prepare(`UPDATE montaggi SET ${fields.join(', ')} WHERE id = ?`)
        .bind(...vals).run()
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

app.delete('/api/montaggi/:id', async (c) => {
  try {
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    // ✅ CORREZIONE: Permetti accesso ad admin O utenti con scope 'montaggi'
    const hasMontaggi = await hasScope(c.env.DB, uid, 'montaggi');
    if (role !== 'admin' && !hasMontaggi) {
      return c.json({ error: 'Accesso negato' }, 403);
    }

    await ensureInit(c.env.DB)
    const id = c.req.param('id')

    await c.env.DB.prepare(`DELETE FROM montaggi WHERE id = ?`).bind(id).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

app.put('/api/montaggi/cliente/:customerId/ordine/:orderId', async (c) => {
  try {
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    // ✅ CORREZIONE: Permetti accesso ad admin O utenti con scope 'montaggi'
    const hasMontaggi = await hasScope(c.env.DB, uid, 'montaggi');
    if (role !== 'admin' && !hasMontaggi) {
      return c.json({ error: 'Accesso negato' }, 403);
    }

    await ensureInit(c.env.DB)
    const customerId = c.req.param('customerId')
    const orderId = c.req.param('orderId')
    const body: any = await c.req.json()

    // Aggiorna tutti i montaggi di questo cliente per questo ordine
    await c.env.DB.prepare(`
      UPDATE montaggi
      SET data_montaggio = ?, ora_montaggio = ?, montatori = ?, priorita = ?, stato = ?, note = ?, updated_at = CURRENT_TIMESTAMP
      WHERE customer_id = ? AND order_id = ?
    `).bind(
      body.data_montaggio || null,
      body.ora_montaggio || null,
      body.montatori || null,
      body.priorita || 'normale',
      body.stato || 'da_programmare',
      body.note || null,
      customerId,
      orderId
    ).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

/* ---------------- MONTAGGIO EXPRESS (Crea tutto in un colpo) ---------------- */
app.post('/api/montaggi/express', async (c) => {
  try {
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    const hasMontaggi = await hasScope(c.env.DB, uid, 'montaggi');
    if (role !== 'admin' && !hasMontaggi) {
      return c.json({ error: 'Accesso negato' }, 403);
    }

    await ensureInit(c.env.DB);
    const b: any = await c.req.json();

    // Validazione
    if (!b.nome || !b.cognome || !b.telefono) {
      return c.json({ error: 'Nome, cognome e telefono sono obbligatori' }, 400);
    }
    if (!b.importo || Number(b.importo) <= 0) {
      return c.json({ error: 'Importo vendita obbligatorio' }, 400);
    }
    if (!b.prodotti_selezionati || b.prodotti_selezionati.length === 0) {
      return c.json({ error: 'Seleziona almeno un prodotto da montare' }, 400);
    }

     // 1. Verifica se cliente esiste già (per telefono o nome+cognome+indirizzo)
    let customerId: number | null = null;
    let clienteEsistente = false;

    // Cerca per telefono (criterio principale)
    if (b.telefono) {
      const existing = await c.env.DB.prepare(`
        SELECT id, nome, cognome, email, indirizzo, citta, cap, provincia 
        FROM customers 
        WHERE telefono = ?
        LIMIT 1
      `).bind(b.telefono).first<any>();

      if (existing) {
        customerId = existing.id;
        clienteEsistente = true;
        
        console.log(`✅ [MONTAGGIO EXPRESS] Cliente esistente trovato (ID: ${customerId})`);

        // Aggiorna solo campi mancanti o vuoti
        const updates: string[] = [];
        const values: any[] = [];

        if (b.nome && !existing.nome) {
          updates.push('nome = ?');
          values.push(b.nome);
        }
        if (b.cognome && !existing.cognome) {
          updates.push('cognome = ?');
          values.push(b.cognome);
        }
        if (b.email && !existing.email) {
          updates.push('email = ?');
          values.push(b.email);
        }
        if (b.indirizzo && !existing.indirizzo) {
          updates.push('indirizzo = ?');
          values.push(b.indirizzo);
        }
        if (b.citta && !existing.citta) {
          updates.push('citta = ?');
          values.push(b.citta);
        }
        if (b.cap && !existing.cap) {
          updates.push('cap = ?');
          values.push(b.cap);
        }
        if (b.provincia && !existing.provincia) {
          updates.push('provincia = ?');
          values.push(b.provincia);
        }

        // Aggiorna stato a "contratto firmato" se diverso
        updates.push('stato = ?');
        values.push('contratto firmato');

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(customerId);

        if (updates.length > 1) { // > 1 perché abbiamo sempre updated_at
          await c.env.DB.prepare(
            `UPDATE customers SET ${updates.join(', ')} WHERE id = ?`
          ).bind(...values).run();
          
          console.log(`✅ [MONTAGGIO EXPRESS] Cliente aggiornato con campi mancanti`);
        }
      }
    }

    // Se non trovato per telefono, cerca per nome+cognome+indirizzo (fallback)
    if (!customerId && b.nome && b.cognome && b.indirizzo) {
      const existing = await c.env.DB.prepare(`
        SELECT id FROM customers 
        WHERE LOWER(nome) = LOWER(?) 
        AND LOWER(cognome) = LOWER(?) 
        AND LOWER(indirizzo) = LOWER(?)
        LIMIT 1
      `).bind(b.nome, b.cognome, b.indirizzo).first<{ id: number }>();

      if (existing) {
        customerId = existing.id;
        clienteEsistente = true;
        
        console.log(`✅ [MONTAGGIO EXPRESS] Cliente esistente trovato per nome+cognome+indirizzo (ID: ${customerId})`);

        // Aggiorna stato e telefono/email se forniti
        const updates: string[] = ['stato = ?'];
        const values: any[] = ['contratto firmato'];

        if (b.telefono) {
          updates.push('telefono = ?');
          values.push(b.telefono);
        }
        if (b.email) {
          updates.push('email = ?');
          values.push(b.email);
        }

        updates.push('updated_at = CURRENT_TIMESTAMP');
        values.push(customerId);

        await c.env.DB.prepare(
          `UPDATE customers SET ${updates.join(', ')} WHERE id = ?`
        ).bind(...values).run();
      }
    }

    // Se ancora non trovato, crea nuovo cliente
    if (!customerId) {
      console.log(`➕ [MONTAGGIO EXPRESS] Creazione nuovo cliente`);
      
      const customerRes: any = await c.env.DB.prepare(`
        INSERT INTO customers (nome, cognome, telefono, email, indirizzo, citta, cap, provincia, stato, assegnato_a)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'contratto firmato', ?)
      `).bind(
        b.nome, 
        b.cognome, 
        b.telefono, 
        b.email || null, 
        b.indirizzo || null, 
        b.citta || null, 
        b.cap || null, 
        b.provincia || null,
        b.venditore_id || uid
      ).run();

      customerId = customerRes.meta?.last_row_id;
    }

    // 2. Crea vendita
    const numero = generateOrderNumber();
    const dataVendita = b.data_vendita || new Date().toISOString().split('T')[0];
    
    const saleRes: any = await c.env.DB.prepare(`
      INSERT INTO sales (numero_ordine, customer_id, user_id, data_vendita, totale, stato, note)
      VALUES (?, ?, ?, ?, ?, 'confermata', 'Creato da Montaggio Express')
    `).bind(numero, customerId, b.venditore_id || uid, dataVendita, Number(b.importo)).run();

    const saleId = saleRes.meta?.last_row_id;

    // 3. Crea ordine
    const orderRes: any = await c.env.DB.prepare(`
      INSERT INTO orders (sale_id, customer_id, user_id, stato)
      VALUES (?, ?, ?, 'in_preparazione')
    `).bind(saleId, customerId, b.venditore_id || uid).run();

    const orderId = orderRes.meta?.last_row_id;

    // 4. Crea order_items per tutti i prodotti (selezionati con data_arrivo = oggi)
    const productTypes = [
      'infissi', 'tapparelle', 'zanzariere', 'scuri',
      'porta_blindata', 'porte_interne', 'veneziane', 'pergole', 'cassonetti'
    ];
    
    const oggi = new Date().toISOString().split('T')[0];

    for (const productType of productTypes) {
      const selezionato = b.prodotti_selezionati.includes(productType) ? 1 : 0;
      const dataArrivo = selezionato ? oggi : null;

      await c.env.DB.prepare(`
        INSERT INTO order_items (order_id, product_type, selezionato, costo, data_prevista, data_arrivo)
        VALUES (?, ?, ?, 0.00, ?, ?)
      `).bind(orderId, productType, selezionato, dataArrivo, dataArrivo).run();
    }

    // 5. Crea montaggi per i prodotti selezionati
    for (const prodotto of b.prodotti_selezionati) {
      await c.env.DB.prepare(`
        INSERT INTO montaggi (order_id, customer_id, product_type, data_montaggio, ora_montaggio, montatori, stato, note, priorita)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'normale')
      `).bind(
        orderId, 
        customerId, 
        prodotto, 
        b.data_montaggio || null, 
        b.ora_montaggio || null, 
        b.montatori || null, 
        b.data_montaggio ? 'programmato' : 'da_programmare',
        b.note || null
      ).run();
    }

    // 6. Crea rilievo automatico
    await c.env.DB.prepare(`
      INSERT INTO rilievi (customer_id, stato, tecnico_id)
      VALUES (?, 'da programmare', NULL)
    `).bind(customerId).run();

    // 7. Log attività
    await c.env.DB.prepare(`
      INSERT INTO activities (tipo, descrizione, customer_id, user_id, metadata)
      VALUES ('montaggio_express', 'Cliente creato da Montaggio Express', ?, ?, ?)
    `).bind(customerId, uid, JSON.stringify({ order_id: orderId, prodotti: b.prodotti_selezionati })).run();

    return c.json({ 
      success: true, 
      customer_id: customerId, 
      order_id: orderId,
      sale_id: saleId,
      cliente_esistente: clienteEsistente
    });

  } catch (e: any) {
    console.error('[MONTAGGIO EXPRESS ERROR]', e);
    return c.json({ error: 'Errore interno: ' + (e?.message || '') }, 500);
  }
});

/* ---------------- PRATICHE ENEA ---------------- */
app.get('/api/pratiche-enea', async (c) => {
  try {
    const role = c.req.header('user-role')
    if (role !== 'admin') {
      return c.json({ error: 'Solo admin può accedere alle pratiche ENEA' }, 403)
    }

    await ensureInit(c.env.DB)
    
    const pratiche = await c.env.DB.prepare(`
      SELECT 
        pe.id,
        pe.montaggio_id,
        pe.customer_id,
        pe.order_id,
        pe.data_completamento_montaggio,
        pe.stato,
        pe.note,
        pe.data_completamento,
        pe.archiviato,
        pe.created_at,
        c.nome,
        c.cognome,
        c.telefono,
        c.email,
        c.indirizzo,
        c.citta,
        c.cap,
        c.provincia,
        m.product_type,
        m.montatori
      FROM pratiche_enea pe
      LEFT JOIN customers c ON c.id = pe.customer_id
      LEFT JOIN montaggi m ON m.id = pe.montaggio_id
      WHERE pe.archiviato = 0
      ORDER BY 
        CASE pe.stato 
          WHEN 'da_fare' THEN 1 
          WHEN 'completato' THEN 2 
        END,
        pe.created_at ASC
    `).all()

    return c.json({ success: true, pratiche: pratiche.results || [] })
  } catch (e: any) {
    console.error('Errore pratiche ENEA:', e)
    return c.json({ error: 'Errore server: ' + e.message }, 500)
  }
})

app.get('/api/pratiche-enea/archiviate', async (c) => {
  try {
    const role = c.req.header('user-role')
    if (role !== 'admin') {
      return c.json({ error: 'Solo admin può accedere alle pratiche ENEA' }, 403)
    }

    await ensureInit(c.env.DB)
    
    const pratiche = await c.env.DB.prepare(`
      SELECT 
        pe.id,
        pe.data_completamento_montaggio,
        pe.data_completamento,
        pe.note,
        c.nome,
        c.cognome,
        c.telefono,
        m.product_type
      FROM pratiche_enea pe
      LEFT JOIN customers c ON c.id = pe.customer_id
      LEFT JOIN montaggi m ON m.id = pe.montaggio_id
      WHERE pe.archiviato = 1
      ORDER BY pe.data_completamento DESC
    `).all()

    return c.json({ success: true, pratiche: pratiche.results || [] })
  } catch (e: any) {
    return c.json({ error: 'Errore server: ' + e.message }, 500)
  }
})

app.put('/api/pratiche-enea/:id', async (c) => {
  try {
    const role = c.req.header('user-role')
    if (role !== 'admin') {
      return c.json({ error: 'Solo admin può modificare pratiche ENEA' }, 403)
    }

    await ensureInit(c.env.DB)
    const id = c.req.param('id')
    const body = await c.req.json()

    const updates = []
    const vals = []

    if (body.stato !== undefined) {
      updates.push('stato = ?')
      vals.push(body.stato)
      
      if (body.stato === 'completato') {
        updates.push('data_completamento = ?')
        vals.push(new Date().toISOString().split('T')[0])
      }
    }
    
    if (body.note !== undefined) {
      updates.push('note = ?')
      vals.push(body.note)
    }
    
    if (body.archiviato !== undefined) {
      updates.push('archiviato = ?')
      vals.push(body.archiviato ? 1 : 0)
    }

    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP')
      vals.push(id)
      
      await c.env.DB.prepare(`
        UPDATE pratiche_enea 
        SET ${updates.join(', ')}
        WHERE id = ?
      `).bind(...vals).run()
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore server: ' + e.message }, 500)
  }
})

app.post('/api/pratiche-enea/crea-da-montaggio/:montaggioId', async (c) => {
  try {
    const role = c.req.header('user-role')
    if (role !== 'admin') {
      return c.json({ error: 'Solo admin può creare pratiche ENEA' }, 403)
    }

    await ensureInit(c.env.DB)
    const montaggioId = c.req.param('montaggioId')

    const montaggio = await c.env.DB.prepare(`
      SELECT m.id, m.customer_id, m.order_id, m.data_montaggio, m.stato
      FROM montaggi m
      WHERE m.id = ?
    `).bind(montaggioId).first()

    if (!montaggio) {
      return c.json({ error: 'Montaggio non trovato' }, 404)
    }

    if (montaggio.stato !== 'completato') {
      return c.json({ error: 'Il montaggio deve essere completato' }, 400)
    }

    const existing = await c.env.DB.prepare(`
      SELECT id FROM pratiche_enea WHERE montaggio_id = ?
    `).bind(montaggioId).first()

    if (existing) {
      return c.json({ error: 'Pratica ENEA già esistente' }, 400)
    }

    await c.env.DB.prepare(`
      INSERT INTO pratiche_enea 
        (montaggio_id, customer_id, order_id, data_completamento_montaggio, stato)
      VALUES (?, ?, ?, ?, 'da_fare')
    `).bind(
      montaggioId,
      montaggio.customer_id,
      montaggio.order_id,
      montaggio.data_montaggio
    ).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore server: ' + e.message }, 500)
  }
})

/* ---------------- PREVENTIVI ---------------- */

app.get('/api/preventivi', async (c) => {
  try {
    await ensureInit(c.env.DB)

    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)

    const url = new URL(c.req.url)
    const limit = 20
    const page = Math.max(Number(url.searchParams.get('page') || 1), 1)
    const offset = (page - 1) * limit

    const filtroStato = url.searchParams.get('stato') || ''
    const filtroCliente = url.searchParams.get('cliente') || ''
    const filtroRichiedente = url.searchParams.get('richiedente') || ''

    let q = `
      SELECT 
        p.*,
        p.note_preventivista,
        (cu.nome || ' ' || cu.cognome) AS cliente,
        cu.telefono AS cliente_telefono,
        cu.email AS cliente_email,
        cu.indirizzo AS cliente_indirizzo,
        cu.citta AS cliente_citta,
        cu.provincia AS cliente_provincia,
        cu.note AS cliente_note,
        u.nome_completo AS richiedente_nome,
        ass.nome_completo AS assegnato_nome,
        ass.nome_completo AS assegnato_a_nome,
        COALESCE(att.allegati_richiesta, 0) AS allegati_richiesta,
        COALESCE(att.allegati_preventivo, 0) AS allegati_preventivo
      FROM preventivi p
      LEFT JOIN customers cu ON cu.id = p.customer_id
      LEFT JOIN users u ON u.id = p.richiedente_id
      LEFT JOIN users ass ON ass.id = p.assegnato_a
      LEFT JOIN (
        SELECT
          preventivo_id,
          SUM(CASE WHEN tipo_allegato = 'richiesta' THEN 1 ELSE 0 END) AS allegati_richiesta,
          SUM(CASE WHEN tipo_allegato = 'preventivo' THEN 1 ELSE 0 END) AS allegati_preventivo
        FROM attachments
        WHERE preventivo_id IS NOT NULL
        GROUP BY preventivo_id
      ) att ON att.preventivo_id = p.id
      WHERE 1=1
    `

    const params: any[] = []

    const hasPreventivi = await hasScope(c.env.DB, uid, 'preventivi')

    if (role === 'venditore' && hasPreventivi) {
      q += ` AND p.stato NOT IN ('preventivo_accettato', 'non_interessato')`
    } else if (role === 'admin') {
      // Admin vede tutto
    } else if (role === 'venditore') {
      q += ` AND p.richiedente_id = ?`
      params.push(uid)
    }

    if (filtroStato) {
      q += ` AND p.stato = ?`
      params.push(filtroStato)
    }

    if (filtroCliente) {
      q += ` AND (cu.nome || ' ' || cu.cognome) LIKE ?`
      params.push(`%${filtroCliente}%`)
    }

    if (filtroRichiedente) {
      q += ` AND u.nome_completo = ?`
      params.push(filtroRichiedente)
    }

    q += `
      ORDER BY 
        CASE p.priorita 
          WHEN 'in_giornata' THEN 1
          WHEN 'entro_48h' THEN 2
          WHEN 'entro_72h' THEN 3
          WHEN 'entro_96h' THEN 4
          ELSE 5
        END,
        p.created_at DESC,
        p.id DESC
      LIMIT ? OFFSET ?
    `

    params.push(limit + 1, offset)

    const rs = await c.env.DB.prepare(q).bind(...params).all()
    const rows = rs.results || []
    const hasMore = rows.length > limit

    return c.json({
      success: true,
      preventivi: hasMore ? rows.slice(0, limit) : rows,
      page,
      limit,
      hasMore
    })
  } catch (e: any) {
    console.error('❌ Errore preventivi:', e)
    return c.json({ error: 'Errore interno: ' + (e?.message || '') }, 500)
  }
})

app.get('/api/preventivi/richiedenti', async (c) => {
  try {
    await ensureInit(c.env.DB)

    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)

    let q = `
      SELECT DISTINCT
        u.nome_completo AS nome
      FROM preventivi p
      LEFT JOIN users u ON u.id = p.richiedente_id
      WHERE u.nome_completo IS NOT NULL
    `

    const params: any[] = []

    const hasPreventivi = await hasScope(c.env.DB, uid, 'preventivi')

    if (role === 'venditore' && hasPreventivi) {
      q += ` AND p.stato NOT IN ('preventivo_accettato', 'non_interessato')`
    } else if (role === 'admin') {
      // Admin vede tutti i richiedenti
    } else if (role === 'venditore') {
      q += ` AND p.richiedente_id = ?`
      params.push(uid)
    }

    q += ` ORDER BY u.nome_completo ASC`

    const rs = await c.env.DB.prepare(q).bind(...params).all()

    return c.json({
      success: true,
      richiedenti: rs.results || []
    })
  } catch (e: any) {
    console.error('❌ Errore richiedenti preventivi:', e)
    return c.json({ error: 'Errore interno: ' + (e?.message || '') }, 500)
  }
})

// Statistiche preventivi per admin
app.get('/api/preventivi/stats/assignments', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || ''
    
    // Solo admin può vedere le statistiche
    if (role !== 'admin') {
      return c.json({ error: 'Non autorizzato' }, 403)
    }

    // Conta preventivi per utente assegnato
    const stats = await c.env.DB.prepare(`
      SELECT 
        u.id,
        u.nome_completo,
        u.username,
        COUNT(CASE WHEN p.stato NOT IN ('preventivo_accettato', 'non_interessato') THEN 1 END) as attivi,
        COUNT(CASE WHEN p.stato = 'in_attesa' THEN 1 END) as in_attesa,
        COUNT(CASE WHEN p.stato = 'in_esecuzione' THEN 1 END) as in_esecuzione,
        COUNT(CASE WHEN p.stato = 'preventivo_inviato' THEN 1 END) as inviati,
        COUNT(CASE WHEN p.stato = 'preventivo_accettato' THEN 1 END) as accettati,
        COUNT(CASE WHEN p.stato = 'non_interessato' THEN 1 END) as non_interessati,
        COUNT(*) as totali
      FROM users u
      LEFT JOIN preventivi p ON p.assegnato_a = u.id
      WHERE u.attivo = 1 AND (u.role = 'admin' OR u.scopes LIKE '%preventivi%')
      GROUP BY u.id, u.nome_completo, u.username
      ORDER BY attivi DESC, totali DESC
    `).all()

    return c.json({ success: true, stats: stats.results || [] })
  } catch (e: any) {
    console.error('❌ Errore stats preventivi:', e)
    return c.json({ error: 'Errore interno: ' + (e?.message || '') }, 500)
  }
})

app.get('/api/preventivi/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)
    const id = c.req.param('id')

    const preventivo = await c.env.DB.prepare(`
      SELECT p.*,
	  p.note_preventivista,
             (cu.nome || ' ' || cu.cognome) AS cliente,
             cu.telefono AS cliente_telefono,
             cu.email AS cliente_email,
             cu.indirizzo AS cliente_indirizzo,
             cu.citta AS cliente_citta,
             cu.provincia AS cliente_provincia,
             cu.note AS cliente_note,
             u.nome_completo AS richiedente_nome,
             ua.nome_completo AS assegnato_nome
      FROM preventivi p
      LEFT JOIN customers cu ON cu.id = p.customer_id
      LEFT JOIN users u ON u.id = p.richiedente_id
      LEFT JOIN users ua ON ua.id = p.assegnato_a
      WHERE p.id = ?
    `).bind(id).first()

    if (!preventivo) {
      return c.json({ error: 'Preventivo non trovato' }, 404)
    }

   // Controllo permessi
const prev = preventivo as any
const hasPreventivi = await hasScope(c.env.DB, uid, 'preventivi')
if (role !== 'admin' && !hasPreventivi && prev.richiedente_id !== uid) {
  return c.json({ error: 'Non autorizzato' }, 403)
}

    return c.json({ success: true, preventivo })
  } catch (e: any) {
    return c.json({ error: 'Errore interno: ' + (e?.message || '') }, 500)
  }
})

app.post('/api/preventivi', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const uid = Number(c.req.header('user-id') || 0)
    const b: any = await c.req.json()

    if (!b.customer_id) {
      return c.json({ error: 'customer_id obbligatorio' }, 400)
    }

    if (!b.priorita) {
      return c.json({ error: 'priorita obbligatoria' }, 400)
    }

   const res: any = await c.env.DB.prepare(`
  INSERT INTO preventivi (customer_id, richiedente_id, stato, priorita, note_richiesta, citta, provincia)
  VALUES (?, ?, 'in_attesa', ?, ?, ?, ?)
`).bind(b.customer_id, uid, b.priorita, b.note_richiesta || null, b.citta || null, b.provincia || null).run()

    const preventivoId = res.meta?.last_row_id

    // Notifica a Isam
    const isamRow = await c.env.DB.prepare(`SELECT id FROM users WHERE username = 'isam' AND attivo = 1`).first<{ id: number }>()
    if (isamRow) {
      await createPreventivoNotifica(c.env.DB, preventivoId, isamRow.id, 'nuova_richiesta')
    }

    // Log attività
    await c.env.DB.prepare(`
      INSERT INTO activities (tipo, descrizione, customer_id, user_id, metadata)
      VALUES ('preventivo_created', 'Richiesta preventivo creata', ?, ?, ?)
    `).bind(b.customer_id, uid, JSON.stringify({ preventivo_id: preventivoId, priorita: b.priorita })).run()

    return c.json({ success: true, preventivo_id: preventivoId })
  } catch (e: any) {
    return c.json({ error: 'Errore interno: ' + (e?.message || '') }, 500)
  }
})


app.put('/api/preventivi/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)
    const id = Number(c.req.param('id'))
    const b: any = await c.req.json()

    // Verifica permessi
    const prev = await c.env.DB.prepare(`SELECT richiedente_id, stato FROM preventivi WHERE id = ?`).bind(id).first<{ richiedente_id: number; stato: string }>()
    if (!prev) {
      return c.json({ error: 'Preventivo non trovato' }, 404)
    }

    const hasPreventivi = await hasScope(c.env.DB, uid, 'preventivi')
    const canEdit = role === 'admin' || hasPreventivi || prev.richiedente_id === uid
    if (!canEdit) {
      return c.json({ error: 'Non autorizzato' }, 403)
    }

    const fields: string[] = []
    const vals: any[] = []

    if ('stato' in b) {
      fields.push('stato = ?')
      vals.push(b.stato)

      // Notifica al richiedente quando il preventivista cambia stato
if (hasPreventivi && prev.stato !== b.stato) {
  await createPreventivoNotifica(c.env.DB, id, prev.richiedente_id, 'stato_aggiornato')
}

    }

    if ('note_richiesta' in b) {
      fields.push('note_richiesta = ?')
      vals.push(b.note_richiesta)
    }
      
	if ('note_preventivista' in b) {
  fields.push('note_preventivista = ?')
  vals.push(b.note_preventivista)
}
  
    fields.push('updated_at = CURRENT_TIMESTAMP')
    vals.push(id)

    if (fields.length > 1) {
      await c.env.DB.prepare(`UPDATE preventivi SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run()
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore interno: ' + (e?.message || '') }, 500)
  }
})

app.delete('/api/preventivi/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)
    const id = c.req.param('id')

    // Permetti a admin E a utenti con scope 'preventivi' (Isam)
    const hasPreventivi = await hasScope(c.env.DB, uid, 'preventivi')
    
    if (role !== 'admin' && !hasPreventivi) {
      return c.json({ error: 'Non autorizzato a eliminare preventivi' }, 403)
    }

    await deletePreventivo(c.env.DB, id)

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore interno: ' + (e?.message || '') }, 500)
  }
})

// Prendi in carico preventivo
app.post('/api/preventivi/:id/assegna', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const uid = Number(c.req.header('user-id') || 0)
    const role = c.req.header('user-role') || ''
    const preventivoId = Number(c.req.param('id'))

    if (!uid) {
      return c.json({ error: 'Non autorizzato' }, 401)
    }

    // Verifica permessi (solo chi ha scope 'preventivi' o admin)
    const hasPreventivi = await hasScope(c.env.DB, uid, 'preventivi')
    if (role !== 'admin' && !hasPreventivi) {
      return c.json({ error: 'Accesso negato: non hai i permessi per gestire i preventivi' }, 403)
    }

    // Recupera il preventivo
    const preventivo = await c.env.DB.prepare(`
      SELECT id, assegnato_a, stato, richiedente_id
      FROM preventivi
      WHERE id = ?
    `).bind(preventivoId).first<any>()

    if (!preventivo) {
      return c.json({ error: 'Preventivo non trovato' }, 404)
    }

    // Se già assegnato a qualcun altro
    if (preventivo.assegnato_a && preventivo.assegnato_a !== uid) {
      const assignedUser = await c.env.DB.prepare(`
        SELECT nome_completo FROM users WHERE id = ?
      `).bind(preventivo.assegnato_a).first<any>()

      return c.json({ 
        error: `Preventivo già assegnato a ${assignedUser?.nome_completo || 'altro utente'}` 
      }, 409)
    }

    // Assegna il preventivo
    await c.env.DB.prepare(`
      UPDATE preventivi 
      SET assegnato_a = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).bind(uid, preventivoId).run()

    // Log attività
    const userInfo = await c.env.DB.prepare(`
      SELECT nome_completo FROM users WHERE id = ?
    `).bind(uid).first<any>()

    await c.env.DB.prepare(`
      INSERT INTO activities (tipo, descrizione, user_id, customer_id)
      VALUES ('preventivo_assegnato', ?, ?, ?)
    `).bind(
      `${userInfo?.nome_completo || 'Utente'} ha preso in carico il preventivo #${preventivoId}`,
      uid,
      preventivo.customer_id || null
    ).run()

    return c.json({ success: true, message: 'Preventivo preso in carico con successo' })
  } catch (e: any) {
    console.error('[ERROR] Assegna preventivo:', e)
    return c.json({ error: 'Errore interno: ' + (e?.message || '') }, 500)
  }
})

// Rilascia preventivo (torna "Da assegnare")
app.post('/api/preventivi/:id/rilascia', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const uid = Number(c.req.header('user-id') || 0)
    const role = c.req.header('user-role') || ''
    const preventivoId = Number(c.req.param('id'))

    if (!uid) {
      return c.json({ error: 'Non autorizzato' }, 401)
    }

    // Verifica permessi
    const hasPreventivi = await hasScope(c.env.DB, uid, 'preventivi')
    if (role !== 'admin' && !hasPreventivi) {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    // Recupera il preventivo
    const preventivo = await c.env.DB.prepare(`
      SELECT id, assegnato_a, customer_id
      FROM preventivi
      WHERE id = ?
    `).bind(preventivoId).first<any>()

    if (!preventivo) {
      return c.json({ error: 'Preventivo non trovato' }, 404)
    }

    // Solo chi l'ha preso o admin può rilasciarlo
    if (role !== 'admin' && preventivo.assegnato_a !== uid) {
      return c.json({ error: 'Non puoi rilasciare un preventivo assegnato ad altri' }, 403)
    }

    // Rilascia
    await c.env.DB.prepare(`
      UPDATE preventivi 
      SET assegnato_a = NULL, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).bind(preventivoId).run()

    // Log attività
    const userInfo = await c.env.DB.prepare(`
      SELECT nome_completo FROM users WHERE id = ?
    `).bind(uid).first<any>()

    await c.env.DB.prepare(`
      INSERT INTO activities (tipo, descrizione, user_id, customer_id)
      VALUES ('preventivo_rilasciato', ?, ?, ?)
    `).bind(
      `${userInfo?.nome_completo || 'Utente'} ha rilasciato il preventivo #${preventivoId}`,
      uid,
      preventivo.customer_id || null
    ).run()

    return c.json({ success: true, message: 'Preventivo rilasciato con successo' })
  } catch (e: any) {
    console.error('[ERROR] Rilascia preventivo:', e)
    return c.json({ error: 'Errore interno: ' + (e?.message || '') }, 500)
  }
})

/* Notifiche preventivi */
app.get('/api/preventivi/notifiche/count', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const uid = Number(c.req.header('user-id') || 0)

    const row = await c.env.DB.prepare(`
      SELECT COUNT(*) as count
      FROM preventivi_notifiche
      WHERE user_id = ? AND letto = 0
    `).bind(uid).first<{ count: number }>()

    return c.json({ count: row?.count || 0 })
  } catch (e: any) {
    return c.json({ error: 'Errore interno: ' + (e?.message || '') }, 500)
  }
})

app.put('/api/preventivi/notifiche/read', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const uid = Number(c.req.header('user-id') || 0)

    await c.env.DB.prepare(`
      UPDATE preventivi_notifiche
      SET letto = 1
      WHERE user_id = ?
    `).bind(uid).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore interno: ' + (e?.message || '') }, 500)
  }
})

/* ---------------- ATTACHMENTS (ENHANCED) ---------------- */
app.post('/api/attachments', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const b: any = await c.req.json()
    const uid = c.req.header('user-id')

    if (!b.filename || !b.data_base64) {
      return c.json({ error: 'Dati file mancanti' }, 400)
    }

    // Validazione dimensione (max 10MB)
    const maxSize = 30 * 1024 * 1024
    const base64Size = b.data_base64.length * 0.75

    if (base64Size > maxSize) {
      return c.json({ error: 'File troppo grande. Massimo 30MB' }, 400)
    }

   const res: any = await c.env.DB.prepare(`
      INSERT INTO attachments (customer_id,appointment_id,preventivo_id,tipo_allegato,filename,mime_type,size,data_base64)
      VALUES (?,?,?,?,?,?,?,?)
    `).bind(
      b.customer_id || null,
      b.appointment_id || null,
      b.preventivo_id || null,
      b.tipo_allegato || 'generico',
      b.filename,
      b.mime_type || 'application/octet-stream',
      Number(b.size) || 0,
      b.data_base64
    ).run()

    if (uid && b.customer_id) {
      await c.env.DB.prepare(`
        INSERT INTO activities (tipo, descrizione, customer_id, user_id)
        VALUES ('file_upload', ?, ?, ?)
      `).bind(`File caricato: ${b.filename}`, b.customer_id, uid).run()
    }

    return c.json({ success: true, id: res.meta?.last_row_id })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

app.get('/api/attachments', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const url = new URL(c.req.url)
    const customer_id = url.searchParams.get('customer_id')
    const appointment_id = url.searchParams.get('appointment_id')
    const preventivo_id = url.searchParams.get('preventivo_id')

    let q = `
      SELECT id, filename, mime_type, size, tipo_allegato, created_at
      FROM attachments
      WHERE 1=1
    `

    const p: any[] = []
    if (customer_id) {
      q += ` AND customer_id = ?`
      p.push(customer_id)
    }

    if (appointment_id) {
      q += ` AND appointment_id = ?`
      p.push(appointment_id)
    }

    if (preventivo_id) {
      q += ` AND preventivo_id = ?`
      p.push(preventivo_id)
    }

    q += ` ORDER BY created_at DESC`

    const r = await c.env.DB.prepare(q).bind(...p).all()
    const list = (r.results || []).map((a: any) => ({
      ...a,
      url: `/api/attachments/${a.id}`
    }))

    return c.json({ success: true, attachments: list })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

/* Bytes inline (PATH mantenuto come si aspetta il front-end) */
app.get('/api/attachments/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const id = c.req.param('id')

    const row = await c.env.DB.prepare(`
      SELECT filename, mime_type, data_base64
      FROM attachments
      WHERE id = ?
    `).bind(id).first<{ filename: string; mime_type: string; data_base64: string }>()

    if (!row) return c.json({ error: 'File non trovato' }, 404)

    const base64 = row.data_base64 || ''
    const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))

    return new Response(bytes, {
      headers: {
        'Content-Type': row.mime_type || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${row.filename.replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=0',
      },
    })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

/* JSON base64 per eventuale download programmatico */
app.get('/api/attachments/download/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const id = c.req.param('id')

    const row = await c.env.DB.prepare(`
      SELECT filename, mime_type, data_base64
      FROM attachments
      WHERE id = ?
    `).bind(id).first<{ filename: string; mime_type: string; data_base64: string }>()

    if (!row) return c.json({ error: 'File non trovato' }, 404)

    return c.json({
      success: true,
      filename: row.filename,
      mime_type: row.mime_type,
      data: row.data_base64
    })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

/* LISTA per customer (spostata di PATH per evitare collisione) */
app.get('/api/attachments/customer/:customerId', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const customerId = c.req.param('customerId')

    const attachments = await c.env.DB.prepare(`
      SELECT id, filename, mime_type, size, created_at,
             CASE 
               WHEN mime_type LIKE 'image/%' THEN 'foto'
               WHEN mime_type LIKE 'application/pdf' THEN 'contratto'
               ELSE 'documento'
             END as category
      FROM attachments
      WHERE customer_id = ?
      ORDER BY created_at DESC
    `).bind(customerId).all()

    return c.json({
      success: true,
      attachments: attachments.results.map((a: any) => ({
        ...a,
        url: `/api/attachments/download/${a.id}`
      }))
    })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

app.delete('/api/attachments/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const id = c.req.param('id')
    const uid = c.req.header('user-id')

    const attachment = await c.env.DB.prepare(`SELECT * FROM attachments WHERE id = ?`)
      .bind(id).first()

    if (!attachment) {
      return c.json({ error: 'Allegato non trovato' }, 404)
    }

    await c.env.DB.prepare(`DELETE FROM attachments WHERE id = ?`).bind(id).run()

    if (uid) {
      await c.env.DB.prepare(`
        INSERT INTO activities (tipo,descrizione,user_id,metadata)
        VALUES ('attachment_deleted','Allegato eliminato',?,?)
      `).bind(uid, JSON.stringify({ attachment_id: id, filename: (attachment as any).filename })).run()
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

/* ---------------- REPORTS (CORRETTO) ---------------- */
app.get('/api/reports/monthly', async (c) => {
  try {
    if (c.req.header('user-role') !== 'admin') {
      return c.json({ error: 'Solo admin può vedere i report' }, 403)
    }

    await ensureInit(c.env.DB)
    const year = (c.req.query('year') || new Date().getFullYear()).toString()
    const month = (c.req.query('month') || (new Date().getMonth() + 1)).toString()

    // Aggregati del mese (entrate/costi)
    const monthlyAgg = await c.env.DB.prepare(`
      SELECT 
        COALESCE(SUM(s.totale), 0) AS revenue,
        COALESCE(
          (SELECT SUM(oi.costo) 
           FROM order_items oi 
           JOIN orders o ON o.id = oi.order_id 
           JOIN sales s2 ON s2.id = o.sale_id 
           WHERE oi.selezionato = 1 
             AND strftime('%Y', s2.data_vendita) = ? 
             AND strftime('%m', s2.data_vendita) = printf('%02d', ?)), 0
        ) AS costs
      FROM sales s
      WHERE strftime('%Y', s.data_vendita) = ? 
        AND strftime('%m', s.data_vendita) = printf('%02d', ?)
    `).bind(year, month, year, month).first<{ revenue: number; costs: number }>()

    // Dettaglio vendite del mese
    const salesDetail = await c.env.DB.prepare(`
      SELECT s.data_vendita, 
             (c.nome || ' ' || c.cognome) AS cliente,
             s.numero_ordine,
             u.nome_completo AS venditore,
             s.totale
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN users u ON u.id = s.user_id
      WHERE strftime('%Y', s.data_vendita) = ? 
        AND strftime('%m', s.data_vendita) = printf('%02d', ?)
      ORDER BY s.data_vendita DESC
    `).bind(year, month).all()

    // Dettaglio costi (order_items) del mese
    const costItems = await c.env.DB.prepare(`
      SELECT (c.nome || ' ' || c.cognome) AS cliente,
             oi.product_type,
             oi.data_prevista,
             oi.data_arrivo,
             oi.costo
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      JOIN sales s ON s.id = o.sale_id
      JOIN customers c ON c.id = o.customer_id
      WHERE oi.selezionato = 1 
        AND strftime('%Y', s.data_vendita) = ? 
        AND strftime('%m', s.data_vendita) = printf('%02d', ?)
      ORDER BY oi.product_type
    `).bind(year, month).all()

    // Andamento annuale (per l'anno selezionato)
    const yearly = await c.env.DB.prepare(`
      SELECT strftime('%Y-%m', s.data_vendita) AS month,
             COALESCE(SUM(s.totale),0) AS revenue,
             COALESCE(SUM(oi.costo * oi.selezionato),0) AS costs
      FROM sales s
      LEFT JOIN orders o ON o.sale_id = s.id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      WHERE strftime('%Y', s.data_vendita) = ?
      GROUP BY strftime('%Y-%m', s.data_vendita)
      ORDER BY month
    `).bind(year).all()

 // 🆕 Statistiche contatti del mese
    const contactStats = await c.env.DB.prepare(`
      SELECT 
        COUNT(DISTINCT c.id) as totale_contatti,
        COUNT(DISTINCT CASE 
          WHEN c.stato = 'solo preventivo' THEN c.id 
        END) as solo_preventivo,
        COUNT(DISTINCT CASE 
          WHEN EXISTS (
            SELECT 1 FROM appointments a 
            WHERE a.customer_id = c.id 
              AND a.interno = 1
              AND strftime('%Y-%m', a.data_ora) = printf('%s-%02d', ?, ?)
          ) THEN c.id 
        END) as appuntamento_interno,
        COUNT(DISTINCT CASE 
          WHEN EXISTS (
            SELECT 1 FROM appointments a 
            WHERE a.customer_id = c.id 
              AND a.interno = 0
              AND strftime('%Y-%m', a.data_ora) = printf('%s-%02d', ?, ?)
          ) THEN c.id 
        END) as appuntamento_venditore,
        COUNT(DISTINCT CASE 
          WHEN c.stato = 'contratto firmato' THEN c.id 
        END) as contratto_firmato,
        COUNT(DISTINCT CASE 
          WHEN c.stato = 'contratto firmato ufficio' THEN c.id 
        END) as contratto_firmato_ufficio
      FROM customers c
      WHERE strftime('%Y-%m', c.created_at) = printf('%s-%02d', ?, ?)
    `).bind(year, month, year, month, year, month).first()

    const report = {
      revenue: monthlyAgg?.revenue || 0,
      costs: monthlyAgg?.costs || 0,
      sales: salesDetail.results || [],
      orderItems: costItems.results || [],
      yearData: yearly.results || [],
      contactStats: {
        totale_contatti: contactStats?.totale_contatti || 0,
        solo_preventivo: contactStats?.solo_preventivo || 0,
        appuntamento_interno: contactStats?.appuntamento_interno || 0,
        appuntamento_venditore: contactStats?.appuntamento_venditore || 0,
        contratto_firmato: contactStats?.contratto_firmato || 0,
        contratto_firmato_ufficio: contactStats?.contratto_firmato_ufficio || 0
      }
    }

    return c.json({ success: true, report })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

/* ---------------- DOWNLOAD REPORT ---------------- */
app.get('/api/reports/monthly/download', async (c) => {
  try {
    if (c.req.header('user-role') !== 'admin') {
      return c.json({ error: 'Solo admin può scaricare i report' }, 403)
    }

    await ensureInit(c.env.DB)
    const year = (c.req.query('year') || new Date().getFullYear()).toString()
    const month = (c.req.query('month') || (new Date().getMonth() + 1)).toString()

    const monthName = new Date(Number(year), Number(month) - 1, 1)
      .toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })

    const monthlyAgg = await c.env.DB.prepare(`
      SELECT 
        COALESCE(SUM(s.totale), 0) AS revenue,
        COALESCE(
          (SELECT SUM(oi.costo) 
           FROM order_items oi 
           JOIN orders o ON o.id = oi.order_id 
           JOIN sales s2 ON s2.id = o.sale_id 
           WHERE oi.selezionato = 1 
             AND strftime('%Y', s2.data_vendita) = ? 
             AND strftime('%m', s2.data_vendita) = printf('%02d', ?)), 0
        ) AS costs
      FROM sales s
      WHERE strftime('%Y', s.data_vendita) = ? 
        AND strftime('%m', s.data_vendita) = printf('%02d', ?)
    `).bind(year, month, year, month).first<{ revenue: number; costs: number }>()

    const salesDetail = await c.env.DB.prepare(`
      SELECT s.data_vendita, 
             (c.nome || ' ' || c.cognome) AS cliente,
             s.numero_ordine,
             u.nome_completo AS venditore,
             s.totale
      FROM sales s
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN users u ON u.id = s.user_id
      WHERE strftime('%Y', s.data_vendita) = ? 
        AND strftime('%m', s.data_vendita) = printf('%02d', ?)
      ORDER BY s.data_vendita DESC
    `).bind(year, month).all()

    // Genera CSV
    let csv = `Report Economico - ${monthName}\n\n`
    csv += `Riepilogo:\n`
    csv += `Entrate,${monthlyAgg?.revenue || 0}\n`
    csv += `Uscite,${monthlyAgg?.costs || 0}\n`
    csv += `Margine,${(monthlyAgg?.revenue || 0) - (monthlyAgg?.costs || 0)}\n\n`
    csv += `Dettaglio Vendite:\n`
    csv += `Data,Cliente,N° Ordine,Venditore,Importo\n`

    for (const sale of (salesDetail.results || [])) {
      const s = sale as any
      csv += `${s.data_vendita},${s.cliente},${s.numero_ordine},${s.venditore},${s.totale}\n`
    }

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="report_${year}_${month}.csv"`
      }
    })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

/* ---------------- DASHBOARD & STATS ---------------- */
app.get('/api/dashboard/stats', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role')
    const uid = c.req.header('user-id')

    const stats: any = {}

    let custQ = `SELECT COUNT(*) as count FROM customers`
    const custP: any[] = []

    if (role === 'venditore') {
      custQ += ` WHERE assegnato_a = ?`
      custP.push(uid)
    }

    const totalCustomers = await c.env.DB.prepare(custQ).bind(...custP).first()
    stats.total_customers = (totalCustomers as any)?.count || 0

    if (role === 'admin') {
      const totalProducts = await c.env.DB.prepare(`SELECT COUNT(*) as count FROM products`).first()
      stats.total_products = (totalProducts as any)?.count || 0
    }

    let q = `SELECT COUNT(*) as count, COALESCE(SUM(totale),0) as revenue FROM sales`
    const p: any[] = []

    if (role === 'venditore') {
      q += ` WHERE user_id = ?`
      p.push(uid)
    }

    const s = await c.env.DB.prepare(q).bind(...p).first()
    stats.total_sales = (s as any)?.count || 0
    stats.total_revenue = (s as any)?.revenue || 0

    let promQ = `SELECT COUNT(*) as count FROM promemoria WHERE stato = 'attivo' AND data_promemoria <= date('now')`
    const promP: any[] = []

    if (role === 'venditore') {
      promQ += ` AND user_id = ?`
      promP.push(uid)
    }

    const prom = await c.env.DB.prepare(promQ).bind(...promP).first()
    stats.promemoria_attivi = (prom as any)?.count || 0

    return c.json({ success: true, stats })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

app.get('/api/dashboard/charts', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role')
    const uid = c.req.header('user-id')

    let q = `
      SELECT strftime('%Y-%m', data_vendita) as month,
             COUNT(*) as count,
             COALESCE(SUM(totale),0) as revenue
      FROM sales
      WHERE data_vendita >= date('now', '-6 months')
    `

    const p: any[] = []
    if (role === 'venditore') {
      q += ` AND user_id = ?`
      p.push(uid)
    }

    q += ` GROUP BY strftime('%Y-%m', data_vendita) ORDER BY month`

    const salesByMonth = await c.env.DB.prepare(q).bind(...p).all()

    return c.json({
      success: true,
      charts: {
        sales_by_month: salesByMonth.results,
        top_products: []
      },
    })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

// GET /api/rilievi/:id/dettagli - Recupera dettagli rilievo completo
app.get('/api/rilievi/:id/dettagli', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const id = c.req.param('id')
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)

    const hasRilievi = await hasScope(c.env.DB, uid, 'rilievi')
    if (role !== 'admin' && !hasRilievi) {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    // Recupera rilievo base
    const rilievo = await c.env.DB.prepare(`
      SELECT r.*, 
             c.nome, c.cognome, c.email, c.telefono, c.indirizzo, c.citta, c.cap, c.provincia, c.codice_fiscale
      FROM rilievi r
      LEFT JOIN customers c ON c.id = r.customer_id
      WHERE r.id = ?
    `).bind(id).first()

    if (!rilievo) {
      return c.json({ error: 'Rilievo non trovato' }, 404)
    }

    // Recupera dettagli (se esistono)
    const dettagli = await c.env.DB.prepare(`
      SELECT * FROM rilievo_dettagli WHERE rilievo_id = ?
    `).bind(id).first<any>()

    return c.json({
      success: true,
      rilievo,
      dettagli: dettagli ? {
        anagrafica: dettagli.anagrafica_json ? JSON.parse(dettagli.anagrafica_json) : null,
        finestre: dettagli.finestre_json ? JSON.parse(dettagli.finestre_json) : [],
        elementi_tecnici: dettagli.elementi_tecnici_json ? JSON.parse(dettagli.elementi_tecnici_json) : null,
        commenti: dettagli.commenti || ''
      } : null
    })
  } catch (e: any) {
    console.error('Errore:', e)
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

// POST /api/rilievi/:id/dettagli - Salva dettagli rilievo completo
app.post('/api/rilievi/:id/dettagli', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const id = c.req.param('id')
    const role = c.req.header('user-role') || ''
    const uid = Number(c.req.header('user-id') || 0)

    const hasRilievi = await hasScope(c.env.DB, uid, 'rilievi')
    if (role !== 'admin' && !hasRilievi) {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    const body = await c.req.json()

    // Verifica che il rilievo esista
    const rilievo = await c.env.DB.prepare('SELECT id FROM rilievi WHERE id = ?').bind(id).first()
    if (!rilievo) {
      return c.json({ error: 'Rilievo non trovato' }, 404)
    }

    // Verifica se esistono già dettagli
    const existing = await c.env.DB.prepare('SELECT id FROM rilievo_dettagli WHERE rilievo_id = ?').bind(id).first()

    if (existing) {
      // UPDATE
      await c.env.DB.prepare(`
        UPDATE rilievo_dettagli 
        SET anagrafica_json = ?,
            finestre_json = ?,
            elementi_tecnici_json = ?,
            commenti = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE rilievo_id = ?
      `).bind(
        JSON.stringify(body.anagrafica || {}),
        JSON.stringify(body.finestre || []),
        JSON.stringify(body.elementi_tecnici || {}),
        body.commenti || '',
        id
      ).run()
    } else {
      // INSERT
      await c.env.DB.prepare(`
        INSERT INTO rilievo_dettagli (rilievo_id, anagrafica_json, finestre_json, elementi_tecnici_json, commenti)
        VALUES (?, ?, ?, ?, ?)
      `).bind(
        id,
        JSON.stringify(body.anagrafica || {}),
        JSON.stringify(body.finestre || []),
        JSON.stringify(body.elementi_tecnici || {}),
        body.commenti || ''
      ).run()
    }

    // Aggiorna stato rilievo a "rilievo eseguito"
    await c.env.DB.prepare(`
      UPDATE rilievi SET stato = 'rilievo eseguito', data_completamento = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(id).run()

    return c.json({ success: true })
  } catch (e: any) {
    console.error('Errore:', e)
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

// Funzione per generare SVG finestra (per PDF backend)
function generateFinestraSVG(finestra: any): string {
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
    const apertura = (tipo_apertura || '').toLowerCase();
    
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
    svg += `<text x="${startX + finestraWidth + 10}" y="${startY + 20}" font-size="10" fill="#059669" font-weight="bold">ZANZARIERA: ${zanzariera}</text>`;
  }
  
  // Cassonetto (se presente)
  if (cassonetto === 'si') {
    svg += `<text x="${startX - 10}" y="${startY - 10}" font-size="10" fill="#7c3aed" font-weight="bold">CASSONETTO</text>`;
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
  const tipoLabel = tipo === 'finestra' ? 'FINESTRA' : tipo === 'porta-finestra' ? 'PORTA-FINESTRA' : 'PORTA';
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

// GET /api/rilievi/:id/pdf - Genera PDF rilievo completo
app.get('/api/rilievi/:id/pdf', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const id = c.req.param('id')
    
    // Recupera rilievo + dettagli
    const rilievo = await c.env.DB.prepare(`
      SELECT r.*, 
             c.nome, c.cognome, c.email, c.telefono, c.indirizzo, c.citta, c.cap, c.provincia, c.codice_fiscale
      FROM rilievi r
      LEFT JOIN customers c ON c.id = r.customer_id
      WHERE r.id = ?
    `).bind(id).first<any>()

    if (!rilievo) {
      return c.json({ error: 'Rilievo non trovato' }, 404)
    }

    const dettagli = await c.env.DB.prepare(`
      SELECT * FROM rilievo_dettagli WHERE rilievo_id = ?
    `).bind(id).first<any>()

    const anagrafica = dettagli?.anagrafica_json ? JSON.parse(dettagli.anagrafica_json) : rilievo
    const finestre = dettagli?.finestre_json ? JSON.parse(dettagli.finestre_json) : []
    const elementi = dettagli?.elementi_tecnici_json ? JSON.parse(dettagli.elementi_tecnici_json) : {}
    const commenti = dettagli?.commenti || ''

    // Genera HTML PDF
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4; margin: 10mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; padding: 5mm; font-size: 9pt; }
    .header { text-align: center; font-size: 14pt; font-weight: bold; margin-bottom: 5mm; border-bottom: 2px solid #000; padding-bottom: 3mm; }
    .section-title { font-size: 10pt; font-weight: bold; margin-top: 5mm; margin-bottom: 2mm; background-color: #e0e0e0; padding: 2mm; border: 1px solid #000; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 5mm; }
    th, td { border: 1px solid #000; padding: 2mm; text-align: left; font-size: 8pt; }
    th { background-color: #f0f0f0; font-weight: bold; }
    .window-sketch { border: 2px solid #000; padding: 5mm; margin: 5mm 0; min-height: 60mm; position: relative; }
    .comments-box { border: 1px solid #000; padding: 5mm; min-height: 80mm; margin-top: 5mm; }
  </style>
</head>
<body>
  <div class="header">RILIEVO TECNICO - ${anagrafica.nome || ''} ${anagrafica.cognome || ''}</div>
  
  <!-- ANAGRAFICA -->
  <div class="section-title">DATI CLIENTE</div>
  <table>
    <tr><td><strong>Nome:</strong></td><td>${anagrafica.nome || ''}</td><td><strong>Cognome:</strong></td><td>${anagrafica.cognome || ''}</td></tr>
    <tr><td><strong>Indirizzo:</strong></td><td colspan="3">${anagrafica.indirizzo || ''}, ${anagrafica.citta || ''} (${anagrafica.provincia || ''})</td></tr>
    <tr><td><strong>CAP:</strong></td><td>${anagrafica.cap || ''}</td><td><strong>Telefono:</strong></td><td>${anagrafica.telefono || ''}</td></tr>
    <tr><td><strong>Email:</strong></td><td colspan="3">${anagrafica.email || ''}</td></tr>
    ${anagrafica.codice_fiscale ? `<tr><td><strong>Codice Fiscale:</strong></td><td colspan="3">${anagrafica.codice_fiscale}</td></tr>` : ''}
  </table>
  
  <!-- FINESTRE -->
  ${finestre.length > 0 ? `
    <div class="section-title">FINESTRE/PORTE</div>
    ${finestre.map((f: any, i: number) => `
      <div class="window-sketch">
       <h4>FINESTRA ${i + 1} - ${f.stanza || 'Non specificata'}</h4>
<div style="text-align: center; margin: 10mm 0;">
  ${generateFinestraSVG(f)}
</div>
<p><strong>Tipo:</strong> ${f.tipo} | <strong>Ante:</strong> ${f.numero_ante} | <strong>Misure:</strong> H ${f.altezza}cm x L ${f.larghezza}cm</p>
<p><strong>Tipo Apertura:</strong> ${f.tipo_apertura || 'Non specificato'}</p>
<p><strong>Tapparella:</strong> ${f.tapparella === 'si' ? 'Sì' : 'No'} | <strong>Cassonetto:</strong> ${f.cassonetto === 'si' ? 'Sì' : 'No'} | <strong>Zanzariera:</strong> ${f.zanzariera || 'No'}</p>
      </div>
    `).join('')}
  ` : ''}
  
  <!-- ELEMENTI TECNICI -->
  ${Object.keys(elementi).length > 0 ? `
    <div class="section-title">ELEMENTI TECNICI</div>
    <table>
      ${elementi.aletta ? `<tr><td><strong>Aletta:</strong></td><td>${elementi.aletta}</td></tr>` : ''}
      ${elementi.ferramenta ? `<tr><td><strong>Ferramenta:</strong></td><td>${elementi.ferramenta}</td></tr>` : ''}
      ${elementi.serratura ? `<tr><td><strong>Serratura:</strong></td><td>${elementi.serratura}</td></tr>` : ''}
      ${elementi.avvolgibiliPVC ? `<tr><td><strong>Avvolgibili PVC:</strong></td><td>${elementi.avvolgibiliPVC}</td></tr>` : ''}
      ${elementi.avvolgibiliAlluminio ? `<tr><td><strong>Avvolgibili Alluminio:</strong></td><td>${elementi.avvolgibiliAlluminio}</td></tr>` : ''}
      ${elementi.piatte ? `<tr><td><strong>Piatte:</strong></td><td>${elementi.piatte}</td></tr>` : ''}
      ${elementi.angolari ? `<tr><td><strong>Angolari:</strong></td><td>${elementi.angolari}</td></tr>` : ''}
      ${elementi.celini ? `<tr><td><strong>Celini:</strong></td><td>${elementi.celini}</td></tr>` : ''}
      ${elementi.varie ? `<tr><td><strong>Varie:</strong></td><td>${elementi.varie}</td></tr>` : ''}
    </table>
  ` : ''}
  
  <!-- COMMENTI -->
  <div class="section-title">NOTE E COMMENTI</div>
  <div class="comments-box">
    ${commenti.replace(/\n/g, '<br>')}
  </div>
</body>
</html>`;

    return c.html(html)
  } catch (e: any) {
    console.error('Errore generazione PDF:', e)
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

/* ---------------- ACTIVITIES ---------------- */
app.get('/api/activities', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role')
    const uid = c.req.header('user-id')

    let q = `
      SELECT a.*, 
             u.nome_completo as user_nome,
             c.nome as customer_nome,
             c.cognome as customer_cognome
      FROM activities a
      LEFT JOIN users u ON a.user_id = u.id
      LEFT JOIN customers c ON a.customer_id = c.id
    `

    const p: any[] = []
    if (role === 'venditore') {
      q += ' WHERE a.user_id = ?'
      p.push(uid)
    }

    q += ' ORDER BY a.data_attivita DESC LIMIT 100'

    const rows = await c.env.DB.prepare(q).bind(...p).all()
    return c.json({ success: true, activities: rows.results })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

/* ---------------- PRODUCTS (Admin only) ---------------- */
app.get('/api/products', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const r = await c.env.DB.prepare(`SELECT * FROM products ORDER BY created_at DESC`).all()
    return c.json({ success: true, products: r.results })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

app.post('/api/products', async (c) => {
  try {
    if (c.req.header('user-role') !== 'admin') {
      return c.json({ error: 'Accesso negato: solo admin' }, 403)
    }

    await ensureInit(c.env.DB)
    const { codice, nome, descrizione, categoria, prezzo_base, prezzo_vendita, giacenza } = await c.req.json() as any

    if (!codice || !nome || !prezzo_vendita) {
      return c.json({ error: 'Codice, nome e prezzo di vendita sono obbligatori' }, 400)
    }

    const res: any = await c.env.DB.prepare(`
      INSERT INTO products (codice,nome,descrizione,categoria,prezzo_base,prezzo_vendita,giacenza)
      VALUES (?,?,?,?,?,?,?)
    `).bind(codice, nome, descrizione, categoria, prezzo_base || 0, prezzo_vendita, giacenza || 0).run()

    return c.json({ success: true, product_id: res.meta?.last_row_id })
  } catch (e: any) {
    if (e?.message?.includes('UNIQUE')) {
      return c.json({ error: 'Codice prodotto già esistente' }, 409)
    }
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

/* ---------------- USERS (Admin only) ---------------- */
app.get('/api/users', async (c) => {
  try {
    if (c.req.header('user-role') !== 'admin') return c.json({ error: 'Accesso negato' }, 403)

    await ensureInit(c.env.DB)
     const users = await c.env.DB.prepare(`
      SELECT id, username, role, nome_completo, email, telefono, attivo, created_at, pc_fingerprint, ultimo_accesso
      FROM users
      ORDER BY created_at DESC
    `).all()

    return c.json({ success: true, users: users.results })
  } catch (e: any) {
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

// POST /api/users/:id/reset-fingerprint - Reset fingerprint per permettere nuovo login
app.post('/api/users/:id/reset-fingerprint', async (c) => {
  try {
    if (c.req.header('user-role') !== 'admin') {
      return c.json({ error: 'Accesso negato: solo admin può resettare i fingerprint' }, 403);
    }

    const userId = Number(c.req.param('id'));
    if (!userId) {
      return c.json({ error: 'ID utente non valido' }, 400);
    }

    await ensureInit(c.env.DB);

    // Verifica che l'utente esista
    const user = await c.env.DB.prepare(`
      SELECT id, username, nome_completo, pc_fingerprint 
      FROM users 
      WHERE id = ?
    `).bind(userId).first<{ id: number; username: string; nome_completo: string; pc_fingerprint: string | null }>();

    if (!user) {
      return c.json({ error: 'Utente non trovato' }, 404);
    }

    // Resetta fingerprint e ultimo_accesso
    await c.env.DB.prepare(`
      UPDATE users 
      SET pc_fingerprint = NULL, ultimo_accesso = NULL 
      WHERE id = ?
    `).bind(userId).run();

    // Log attività
    const adminId = Number(c.req.header('user-id') || 0);
    if (adminId) {
      await c.env.DB.prepare(`
        INSERT INTO activities (tipo, descrizione, user_id, metadata)
        VALUES ('system', 'Reset fingerprint dispositivo', ?, ?)
      `).bind(adminId, JSON.stringify({ 
        target_user: user.username,
        target_user_id: userId,
        old_fingerprint: user.pc_fingerprint ? 'presente' : 'assente'
      })).run();
    }

    return c.json({ 
      success: true, 
      message: `Fingerprint resettato per ${user.nome_completo} (${user.username})` 
    });
  } catch (e: any) {
    console.error('[RESET FINGERPRINT ERROR]', e);
    return c.json({ error: 'Errore interno: ' + (e?.message || '') }, 500);
  }
});

/* ---------------- DOWNLOAD TEMPLATE EXCEL ---------------- */
app.get('/api/import/customers/template', async (c) => {
  try {
    if (c.req.header('user-role') !== 'admin') {
      return c.json({ error: 'Solo admin può scaricare il template' }, 403)
    }

    const csv = `nome,cognome,email,telefono,azienda,indirizzo,citta,cap,provincia,note,assegnato_a,stato,data_richiamo
Mario,Rossi,mario.rossi@email.com,3331234567,Azienda SRL,Via Roma 123,Milano,20100,MI,Cliente interessato,1,nuovo,2024-12-15
Luigi,Bianchi,luigi.bianchi@email.com,3339876543,Bianchi Co,Via Verdi 45,Roma,00100,RM,Preventivo tapparelle,2,richiamare,2024-12-20
Anna,Verdi,anna.verdi@email.com,3335551234,,Corso Italia 78,Torino,10100,TO,Porte blindate,,nuovo,
# ISTRUZIONI:
# nome,cognome: OBBLIGATORI
# email,telefono,azienda,indirizzo,citta,cap,provincia,note: OPZIONALI
# assegnato_a: ID numerico del venditore (1,2,3,4) o vuoto
# stato: nuovo,richiamare,agendato con venditore,agendato interno,contratto firmato,non interessato
# data_richiamo: formato YYYY-MM-DD o vuoto`

    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="template_import_clienti.csv"',
        'Cache-Control': 'no-cache'
      }
    })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

/* ---------------- IMPORT EXCEL ---------------- */
app.post('/api/import/customers', async (c) => {
  try {
    if (c.req.header('user-role') !== 'admin') {
      return c.json({ error: 'Solo admin può importare clienti' }, 403)
    }

    await ensureInit(c.env.DB)
    const { customers } = await c.req.json() as { customers: any[] }

    let imported = 0
    let errors: any[] = []

    for (const customer of customers) {
      try {
        if (!customer.nome || !customer.cognome) {
          errors.push({ row: customer, error: 'Nome e cognome sono obbligatori' })
          continue
        }

        await c.env.DB.prepare(`
          INSERT INTO customers (
            nome, cognome, email, telefono, azienda, indirizzo, citta, cap, provincia, note,
            assegnato_a, stato, data_richiamo
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).bind(
          customer.nome, customer.cognome, customer.email || null, customer.telefono || null,
          customer.azienda || null, customer.indirizzo || null, customer.citta || null,
          customer.cap || null, customer.provincia || null, customer.note || null,
          customer.assegnato_a || null, customer.stato || 'nuovo', customer.data_richiamo || null
        ).run()

        imported++
      } catch (e: any) {
        errors.push({ row: customer, error: e.message || 'Errore sconosciuto' })
      }
    }

    return c.json({
      success: true,
      imported,
      errors,
      message: `Importati ${imported} clienti su ${customers.length}`
    })
  } catch (e: any) {
    return c.json({ error: 'Errore interno: ' + e.message }, 500)
  }
})

/* ---------------- AUDIT ---------------- */
// GET /api/audit?from=YYYY-MM-DD&to=YYYY-MM-DD[&user_id=NUM]
app.get('/api/audit', async (c) => {
  try {
    await ensureInit(c.env.DB)

    // SOLO admin (se vuoi usare uno scope vedi più sotto Step 4)
    if ((c.req.header('user-role') || '') !== 'admin') {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    const from = c.req.query('from') || null
    const to   = c.req.query('to')   || null
    const uidQ = c.req.query('user_id') || null

    if (!from || !to) {
      return c.json({ error: "Parametri 'from' e 'to' obbligatori (YYYY-MM-DD)" }, 400)
    }

    const paramsAppt: any[] = [from, to]
    const paramsAct:  any[] = [from, to]
    if (uidQ) { paramsAppt.push(uidQ) }
    if (uidQ) { paramsAct.push(uidQ) }

    // ---- STATISTICHE
    const totalSecondsRow = await c.env.DB.prepare(`
      SELECT COALESCE(SUM(a.durata_min)*60,0) AS total_seconds
      FROM appointments a
      WHERE date(a.data_ora) BETWEEN ? AND ?
      ${uidQ ? ' AND a.user_id = ?' : ''}
    `).bind(...paramsAppt).first<{ total_seconds: number }>()

    const actionsCountRow = await c.env.DB.prepare(`
      SELECT COUNT(*) AS actions_count
      FROM activities x
      WHERE date(x.data_attivita) BETWEEN ? AND ?
      ${uidQ ? ' AND x.user_id = ?' : ''}
    `).bind(...paramsAct).first<{ actions_count: number }>()

    const uniqueCustomersRow = await c.env.DB.prepare(`
      SELECT COUNT(DISTINCT cid) AS unique_customers
      FROM (
        SELECT a.customer_id AS cid
        FROM appointments a
        WHERE a.customer_id IS NOT NULL
          AND date(a.data_ora) BETWEEN ? AND ?
          ${uidQ ? ' AND a.user_id = ?' : ''}
        UNION
        SELECT y.customer_id AS cid
        FROM activities y
        WHERE y.customer_id IS NOT NULL
          AND date(y.data_attivita) BETWEEN ? AND ?
          ${uidQ ? ' AND y.user_id = ?' : ''}
      )
    `).bind(
      ...paramsAppt, // from,to,[uid]
      ...paramsAct   // from,to,[uid]
    ).first<{ unique_customers: number }>()

    const stats = {
      total_seconds: totalSecondsRow?.total_seconds || 0,
      actions_count: actionsCountRow?.actions_count || 0,
      unique_customers: uniqueCustomersRow?.unique_customers || 0,
    }

    // ---- TEMPO PER UTENTE
    const timeByUser = await c.env.DB.prepare(`
      SELECT 
        u.id AS user_id,
        u.nome_completo AS user_name,
        COALESCE(SUM(a.durata_min)*60,0) AS seconds
      FROM appointments a
      JOIN users u ON u.id = a.user_id
      WHERE date(a.data_ora) BETWEEN ? AND ?
      ${uidQ ? ' AND a.user_id = ?' : ''}
      GROUP BY u.id, u.nome_completo
      ORDER BY seconds DESC
    `).bind(...paramsAppt).all()

    // ---- TEMPO PER CLIENTE
    const timeByCustomer = await c.env.DB.prepare(`
      SELECT 
        c.id AS customer_id,
        (c.nome || ' ' || c.cognome) AS customer_name,
        COALESCE(SUM(a.durata_min)*60,0) AS seconds
      FROM appointments a
      JOIN customers c ON c.id = a.customer_id
      WHERE date(a.data_ora) BETWEEN ? AND ?
      ${uidQ ? ' AND a.user_id = ?' : ''}
      GROUP BY c.id, c.nome, c.cognome
      ORDER BY seconds DESC
    `).bind(...paramsAppt).all()




    // ---- LOGS (activities + appointments)
    const logsActivities = await c.env.DB.prepare(`
      SELECT 
        strftime('%Y-%m-%dT%H:%M:%S', a.data_attivita) AS "when",
        u.nome_completo AS user_name,
        a.tipo          AS action,
        COALESCE((c.nome || ' ' || c.cognome), '') AS customer_name,
        TRIM(
          COALESCE(a.descrizione,'') || 
          CASE 
            WHEN a.metadata IS NOT NULL AND a.metadata <> '' 
            THEN (' | ' || a.metadata) 
            ELSE '' 
          END
        ) AS details,
        NULL AS duration_sec
      FROM activities a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN customers c ON c.id = a.customer_id
      WHERE date(a.data_attivita) BETWEEN ? AND ?
      ${uidQ ? ' AND a.user_id = ?' : ''}
    `).bind(...paramsAct).all()

    const logsAppointments = await c.env.DB.prepare(`
      SELECT
        strftime('%Y-%m-%dT%H:%M:%S', a.data_ora) AS "when",
        u.nome_completo AS user_name,
        'appointment'   AS action,
        (c.nome || ' ' || c.cognome) AS customer_name,
        TRIM(COALESCE(a.titolo,'') || CASE WHEN a.descrizione IS NOT NULL THEN (' - ' || a.descrizione) ELSE '' END) AS details,
        (COALESCE(a.durata_min,0)*60) AS duration_sec
      FROM appointments a
      LEFT JOIN users u ON u.id = a.user_id
      LEFT JOIN customers c ON c.id = a.customer_id
      WHERE date(a.data_ora) BETWEEN ? AND ?
      ${uidQ ? ' AND a.user_id = ?' : ''}
    `).bind(...paramsAppt).all()

    const logsCombined = [
      ...((logsActivities.results || []) as any[]),
      ...((logsAppointments.results || []) as any[]),
    ].sort((l, r) => (r.when || '').localeCompare(l.when || ''))

    return c.json({
      stats,
      time_by_user: (timeByUser.results || []),
      time_by_customer: (timeByCustomer.results || []),
      logs: logsCombined
    })
  } catch (e: any) {
    console.error('[AUDIT ERROR]', e)
    return c.json({ error: 'Errore interno del server: ' + (e?.message || '') }, 500)
  }
})

/* ---------------- META LEAD ADS API ---------------- */

// GET /api/meta/leads - Lista tutti i lead
app.get('/api/meta/leads', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role')
    
    if (role !== 'admin') {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    const status = c.req.query('status') // 'new', 'contacted', 'converted'
    
    let q = `
      SELECT ml.*,
             (cu.nome || ' ' || cu.cognome) AS customer_name
      FROM meta_leads ml
      LEFT JOIN customers cu ON cu.id = ml.customer_id
      WHERE 1=1
    `
    const params: any[] = []

    if (status) {
      q += ` AND ml.status = ?`
      params.push(status)
    }

    q += ` ORDER BY ml.imported_at DESC`

    const leads = await c.env.DB.prepare(q).bind(...params).all()
    
    return c.json({ success: true, leads: leads.results || [] })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

// GET /api/meta/leads/sync - Sincronizza nuovi lead da Meta
app.get('/api/meta/leads/sync', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role')
    
    if (role !== 'admin') {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    const accessToken = c.env.META_ACCESS_TOKEN
    const pageId = c.env.META_PAGE_ID

    if (!accessToken || !pageId) {
      return c.json({ error: 'Credenziali Meta non configurate' }, 500)
    }

    // Recupera lead forms dalla pagina
    const formsData = await callMetaAPI(
      `${pageId}/leadgen_forms?fields=id,name`,
      accessToken
    )

    let newLeadsCount = 0
    const forms = formsData.data || []

    for (const form of forms) {
      // Recupera lead per ogni form
      const leadsData = await callMetaAPI(
        `${form.id}/leads?fields=id,created_time,field_data`,
        accessToken
      )

      for (const lead of (leadsData.data || [])) {
        // Verifica se già importato
        const existing = await c.env.DB.prepare(
          `SELECT id FROM meta_leads WHERE lead_id = ?`
        ).bind(lead.id).first()

        if (!existing) {
          // Importa nuovo lead
          await c.env.DB.prepare(`
            INSERT INTO meta_leads (lead_id, form_id, page_id, field_data, created_time, status)
            VALUES (?, ?, ?, ?, ?, 'new')
          `).bind(
            lead.id,
            form.id,
            pageId,
            JSON.stringify(lead.field_data),
            lead.created_time
          ).run()

          newLeadsCount++
        }
      }
    }

    return c.json({ 
      success: true, 
      message: `Sincronizzati ${newLeadsCount} nuovi lead`,
      new_leads: newLeadsCount 
    })
  } catch (e: any) {
    return c.json({ error: 'Errore sincronizzazione: ' + e.message }, 500)
  }
})

// POST /api/meta/leads/webhook - Webhook per lead in tempo reale
app.post('/api/meta/leads/webhook', async (c) => {
  try {
    await ensureInit(c.env.DB)
    
    const body: any = await c.req.json()
    
    // Processa webhook entries
    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        if (change.value?.leadgen_id) {
          const leadId = change.value.leadgen_id
          const formId = change.value.form_id
          const pageId = change.value.page_id

          // Verifica se già importato
          const existing = await c.env.DB.prepare(
            `SELECT id FROM meta_leads WHERE lead_id = ?`
          ).bind(leadId).first()

          if (!existing) {
            // Recupera dettagli lead da Meta API
            const accessToken = c.env.META_ACCESS_TOKEN
            
            if (accessToken) {
              const leadData = await callMetaAPI(
                `${leadId}?fields=id,created_time,field_data`,
                accessToken
              )

              await c.env.DB.prepare(`
                INSERT INTO meta_leads (lead_id, form_id, page_id, field_data, created_time, status)
                VALUES (?, ?, ?, ?, ?, 'new')
              `).bind(
                leadId,
                formId,
                pageId,
                JSON.stringify(leadData.field_data),
                leadData.created_time
              ).run()
            }
          }
        }
      }
    }

    return c.json({ success: true })
  } catch (e: any) {
    console.error('[META WEBHOOK ERROR]', e)
    return c.json({ error: 'Errore webhook: ' + e.message }, 500)
  }
})

// GET /api/meta/leads/webhook - Webhook verification (Meta requirement)
app.get('/api/meta/leads/webhook', async (c) => {
  const mode = c.req.query('hub.mode')
  const token = c.req.query('hub.verify_token')
  const challenge = c.req.query('hub.challenge')

  const verifyToken = c.env.META_VERIFY_TOKEN || 'your-verify-token-here'

  if (mode === 'subscribe' && token === verifyToken) {
    return c.text(challenge || '')
  }

  return c.json({ error: 'Forbidden' }, 403)
})

// PUT /api/meta/leads/:id - Aggiorna lead (converti in cliente)
app.put('/api/meta/leads/:id', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role')
    const id = c.req.param('id')
    const body: any = await c.req.json()
    
    if (role !== 'admin') {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    const fields: string[] = []
    const vals: any[] = []

    if ('status' in body) {
      fields.push('status = ?')
      vals.push(body.status)
    }

    if ('customer_id' in body) {
      fields.push('customer_id = ?')
      vals.push(body.customer_id)
    }

    if (fields.length) {
      vals.push(id)
      await c.env.DB.prepare(
        `UPDATE meta_leads SET ${fields.join(', ')} WHERE id = ?`
      ).bind(...vals).run()
    }

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

/* ---------------- META CONVERSIONS API ---------------- */

// POST /api/meta/conversions/track - Invia evento conversione
app.post('/api/meta/conversions/track', async (c) => {
  try {
    await ensureInit(c.env.DB)
    
    const body: any = await c.req.json()
    const pixelId = c.env.META_PIXEL_ID
    const conversionToken = c.env.META_CONVERSIONS_TOKEN

    if (!pixelId || !conversionToken) {
      return c.json({ error: 'Conversions API non configurata' }, 500)
    }

    // Validazione
    if (!body.event_name || !body.event_time) {
      return c.json({ error: 'event_name e event_time obbligatori' }, 400)
    }

    // Hash user data se presente
    const userData: any = {}
    if (body.email) {
      userData.em = [await hashSHA256(body.email)]
    }
    if (body.phone) {
      userData.ph = [await hashSHA256(body.phone)]
    }
    if (body.first_name) {
      userData.fn = await hashSHA256(body.first_name)
    }
    if (body.last_name) {
      userData.ln = await hashSHA256(body.last_name)
    }
    if (body.city) {
      userData.ct = await hashSHA256(body.city)
    }
    if (body.state) {
      userData.st = await hashSHA256(body.state)
    }
    if (body.zip) {
      userData.zp = await hashSHA256(body.zip)
    }

    // Prepara evento
    const eventData = {
      event_name: body.event_name,
      event_time: body.event_time,
      user_data: userData,
      custom_data: body.custom_data || {},
      event_id: body.event_id || `${Date.now()}-${Math.random()}`,
      action_source: body.action_source || 'website'
    }

    // Invia a Meta
    const result = await sendMetaConversion(
      pixelId,
      conversionToken,
      body.event_name,
      eventData
    )

    // Salva in database
    await c.env.DB.prepare(`
      INSERT INTO meta_conversions (
        event_name, event_time, user_data, custom_data, event_id, customer_id, sale_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      body.event_name,
      body.event_time,
      JSON.stringify(userData),
      JSON.stringify(body.custom_data || {}),
      eventData.event_id,
      body.customer_id || null,
      body.sale_id || null
    ).run()

    return c.json({ 
      success: true, 
      event_id: eventData.event_id,
      meta_response: result 
    })
  } catch (e: any) {
    return c.json({ error: 'Errore conversione: ' + e.message }, 500)
  }
})

// GET /api/meta/conversions - Lista conversioni
app.get('/api/meta/conversions', async (c) => {
  try {
    await ensureInit(c.env.DB)
    const role = c.req.header('user-role')
    
    if (role !== 'admin') {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    const conversions = await c.env.DB.prepare(`
      SELECT mc.*,
             (cu.nome || ' ' || cu.cognome) AS customer_name,
             s.numero_ordine
      FROM meta_conversions mc
      LEFT JOIN customers cu ON cu.id = mc.customer_id
      LEFT JOIN sales s ON s.id = mc.sale_id
      ORDER BY mc.created_at DESC
      LIMIT 100
    `).all()

    return c.json({ success: true, conversions: conversions.results || [] })
  } catch (e: any) {
    return c.json({ error: 'Errore: ' + e.message }, 500)
  }
})

/* ---------------- META GRAPH API ---------------- */

// GET /api/meta/insights - Analytics pagina Facebook
app.get('/api/meta/insights', async (c) => {
  try {
    const role = c.req.header('user-role')
    
    if (role !== 'admin') {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    const accessToken = c.env.META_ACCESS_TOKEN
    const pageId = c.env.META_PAGE_ID

    if (!accessToken || !pageId) {
      return c.json({ error: 'Graph API non configurata' }, 500)
    }

    // Recupera insights
    const insights = await callMetaAPI(
      `${pageId}/insights?metric=page_impressions,page_engaged_users,page_fans&period=day`,
      accessToken
    )

    return c.json({ success: true, insights: insights.data || [] })
  } catch (e: any) {
    return c.json({ error: 'Errore insights: ' + e.message }, 500)
  }
})

// GET /api/meta/posts - Lista post pubblicati
app.get('/api/meta/posts', async (c) => {
  try {
    const role = c.req.header('user-role')
    
    if (role !== 'admin') {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    const accessToken = c.env.META_ACCESS_TOKEN
    const pageId = c.env.META_PAGE_ID

    if (!accessToken || !pageId) {
      return c.json({ error: 'Graph API non configurata' }, 500)
    }

    // Recupera post
    const posts = await callMetaAPI(
      `${pageId}/posts?fields=id,message,created_time,likes.summary(true),comments.summary(true)`,
      accessToken
    )

    return c.json({ success: true, posts: posts.data || [] })
  } catch (e: any) {
    return c.json({ error: 'Errore post: ' + e.message }, 500)
  }
})

// POST /api/meta/post - Pubblica nuovo post
app.post('/api/meta/post', async (c) => {
  try {
    const role = c.req.header('user-role')
    
    if (role !== 'admin') {
      return c.json({ error: 'Accesso negato' }, 403)
    }

    const accessToken = c.env.META_ACCESS_TOKEN
    const pageId = c.env.META_PAGE_ID

    if (!accessToken || !pageId) {
      return c.json({ error: 'Graph API non configurata' }, 500)
    }

    const body: any = await c.req.json()

    if (!body.message) {
      return c.json({ error: 'Messaggio obbligatorio' }, 400)
    }

    // Pubblica post
    const result = await callMetaAPI(
      `${pageId}/feed`,
      accessToken,
      'POST',
      { message: body.message }
    )

    return c.json({ 
      success: true, 
      post_id: result.id,
      message: 'Post pubblicato con successo' 
    })
  } catch (e: any) {
    return c.json({ error: 'Errore pubblicazione: ' + e.message }, 500)
  }
})

/* ==================== PRESENZE ==================== */

// GET /api/presenze - Lista presenze (filtri: user_id, mese)
app.get('/api/presenze', async (c) => {
  try {
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    const hasPresenze = await hasScope(c.env.DB, uid, 'presenze');
    if (role !== 'admin' && !hasPresenze) {
      return c.json({ error: 'Accesso negato' }, 403);
    }

    await ensureInit(c.env.DB);
    
    const userId = c.req.query('user_id') || '';
    const mese = c.req.query('mese') || '';
    
    let sql = `
      SELECT p.*, u.nome_completo, u.username
      FROM presenze p
      LEFT JOIN users u ON u.id = p.user_id
      WHERE 1=1
    `;
    
    const bindings: any[] = [];
    
    if (userId) {
      sql += ` AND p.user_id = ?`;
      bindings.push(Number(userId));
    }
    
    if (mese) {
      sql += ` AND strftime('%Y-%m', p.data) = ?`;
      bindings.push(mese);
    }
    
    sql += ` ORDER BY p.data DESC, p.ora_entrata DESC`;
    
    const result = await c.env.DB.prepare(sql).bind(...bindings).all();
    
    return c.json({ success: true, presenze: result.results || [] });
  } catch (e: any) {
    console.error('[PRESENZE GET ERROR]', e);
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/presenze/entrata - Timbra entrata
app.post('/api/presenze/entrata', async (c) => {
  try {
    const uid = Number(c.req.header('user-id') || 0);
    if (!uid) return c.json({ error: 'Non autorizzato' }, 401);

    await ensureInit(c.env.DB);
    
    const body: any = await c.req.json();
    const { password, pc_fingerprint, ip_address } = body;
    
    const user = await c.env.DB.prepare(`SELECT password FROM users WHERE id = ?`)
      .bind(uid).first<{ password: string }>();
    
    if (!user || user.password !== password) {
      return c.json({ error: 'Password errata' }, 401);
    }
    
    const oggi = new Date().toISOString().split('T')[0];
    const oraAttuale = new Date().toTimeString().split(' ')[0];
    
    const existing = await c.env.DB.prepare(`
      SELECT id, pc_fingerprint FROM presenze WHERE user_id = ? AND data = ?
    `).bind(uid, oggi).first<{ id: number; pc_fingerprint: string }>();
    
    if (existing) {
      if (existing.pc_fingerprint && existing.pc_fingerprint !== pc_fingerprint) {
        return c.json({ error: 'Devi timbrare dallo stesso PC del primo accesso' }, 403);
      }
      
      return c.json({ error: 'Presenza già registrata oggi' }, 400);
    }
    
    await c.env.DB.prepare(`
      INSERT INTO presenze (user_id, data, ora_entrata, pc_fingerprint, ip_address, confermata)
      VALUES (?, ?, ?, ?, ?, 1)
    `).bind(uid, oggi, oraAttuale, pc_fingerprint, ip_address).run();
    
    return c.json({ success: true, message: 'Entrata registrata' });
  } catch (e: any) {
    console.error('[PRESENZE ENTRATA ERROR]', e);
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/presenze/uscita - Timbra uscita
app.post('/api/presenze/uscita', async (c) => {
  try {
    const uid = Number(c.req.header('user-id') || 0);
    if (!uid) return c.json({ error: 'Non autorizzato' }, 401);

    await ensureInit(c.env.DB);
    
    const body: any = await c.req.json();
    const { password } = body;
    
    const user = await c.env.DB.prepare(`SELECT password FROM users WHERE id = ?`)
      .bind(uid).first<{ password: string }>();
    
    if (!user || user.password !== password) {
      return c.json({ error: 'Password errata' }, 401);
    }
    
    const oggi = new Date().toISOString().split('T')[0];
    const oraAttuale = new Date().toTimeString().split(' ')[0];
    
    const presenza = await c.env.DB.prepare(`
      SELECT id, ora_entrata FROM presenze WHERE user_id = ? AND data = ?
    `).bind(uid, oggi).first<{ id: number; ora_entrata: string }>();
    
    if (!presenza) {
      return c.json({ error: 'Non hai timbrato l\'entrata oggi' }, 400);
    }
    
    if (!presenza.ora_entrata) {
      return c.json({ error: 'Entrata non registrata' }, 400);
    }
    
    await c.env.DB.prepare(`
      UPDATE presenze SET ora_uscita = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).bind(oraAttuale, presenza.id).run();
    
    return c.json({ success: true, message: 'Uscita registrata' });
  } catch (e: any) {
    console.error('[PRESENZE USCITA ERROR]', e);
    return c.json({ error: e.message }, 500);
  }
});

// GET /api/presenze/oggi - Presenza di oggi dell'utente loggato
app.get('/api/presenze/oggi', async (c) => {
  try {
    const uid = Number(c.req.header('user-id') || 0);
    if (!uid) return c.json({ error: 'Non autorizzato' }, 401);

    await ensureInit(c.env.DB);
    
    const oggi = new Date().toISOString().split('T')[0];
    
    const presenza = await c.env.DB.prepare(`
      SELECT * FROM presenze WHERE user_id = ? AND data = ?
    `).bind(uid, oggi).first();
    
    return c.json({ success: true, presenza: presenza || null });
  } catch (e: any) {
    console.error('[PRESENZE OGGI ERROR]', e);
    return c.json({ error: e.message }, 500);
  }
});

// PUT /api/presenze/:id - Modifica presenza (solo admin/presenze scope)
app.put('/api/presenze/:id', async (c) => {
  try {
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    const hasPresenze = await hasScope(c.env.DB, uid, 'presenze');
    if (role !== 'admin' && !hasPresenze) {
      return c.json({ error: 'Accesso negato' }, 403);
    }

    await ensureInit(c.env.DB);
    
    const id = c.req.param('id');
    const body: any = await c.req.json();
    
    const fields: string[] = [];
    const vals: any[] = [];
    
    for (const k of ['ora_entrata', 'ora_uscita', 'pausa_pranzo', 'tipo', 'note']) {
      if (k in body) {
        fields.push(`${k} = ?`);
        vals.push(body[k]);
      }
    }
    
    if (fields.length === 0) {
      return c.json({ error: 'Nessun campo da aggiornare' }, 400);
    }
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(id);
    
    await c.env.DB.prepare(`UPDATE presenze SET ${fields.join(', ')} WHERE id = ?`)
      .bind(...vals).run();
    
    return c.json({ success: true, message: 'Presenza aggiornata' });
  } catch (e: any) {
    console.error('[PRESENZE UPDATE ERROR]', e);
    return c.json({ error: e.message }, 500);
  }
});

// POST /api/presenze/manuale - Inserimento manuale (ferie, malattia, permesso)
app.post('/api/presenze/manuale', async (c) => {
  try {
    const role = c.req.header('user-role') || '';
    const uid = Number(c.req.header('user-id') || 0);
    
    const hasPresenze = await hasScope(c.env.DB, uid, 'presenze');
    if (role !== 'admin' && !hasPresenze) {
      return c.json({ error: 'Accesso negato' }, 403);
    }

    await ensureInit(c.env.DB);
    
    const body: any = await c.req.json();
    const { user_id, data, tipo, note } = body;
    
    if (!user_id || !data || !tipo) {
      return c.json({ error: 'user_id, data e tipo sono obbligatori' }, 400);
    }
    
    const existing = await c.env.DB.prepare(`
      SELECT id FROM presenze WHERE user_id = ? AND data = ?
    `).bind(user_id, data).first();
    
    if (existing) {
      return c.json({ error: 'Presenza già esistente per questa data' }, 400);
    }
    
    await c.env.DB.prepare(`
      INSERT INTO presenze (user_id, data, tipo, note, confermata)
      VALUES (?, ?, ?, ?, 1)
    `).bind(user_id, data, tipo, note || null).run();
    
    return c.json({ success: true, message: 'Presenza inserita' });
  } catch (e: any) {
    console.error('[PRESENZE MANUALE ERROR]', e);
    return c.json({ error: e.message }, 500);
  }
});

// DELETE /api/presenze/:id - Elimina presenza
app.delete('/api/presenze/:id', async (c) => {
const id = Number(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM presenze WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});
/* ---------------- PRESENZE API ---------------- */

// GET /api/presenze - Lista presenze (con filtri)
app.notFound((c) => c.json({ error: 'Endpoint non trovato' }, 404))

export default {
  fetch: (request: Request, env: Bindings, ctx: ExecutionContext) =>
    app.fetch(request, env, ctx),
}

/* ============================================
   📊 EXPORT DATA ENDPOINTS
   ============================================ */

// Helper per CSV
function toCSV(headers: string[], rows: any[][]): string {
  const escape = (v: any) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n') 
      ? `"${s.replace(/"/g, '""')}"` 
      : s;
  };
  
  const lines = [
    headers.map(escape).join(','),
    ...rows.map(row => row.map(escape).join(','))
  ];
  
  return '\uFEFF' + lines.join('\n'); // BOM per Excel italiano
}

// 1. EXPORT CLIENTI COMPLETO
app.get('/api/export/customers', async (c) => {
  await ensureInit(c.env.DB);
  
  const rows = await c.env.DB.prepare(`
    SELECT 
      c.id,
      c.created_at AS data_creazione,
      c.nome,
      c.cognome,
      c.email,
      c.telefono,
      c.azienda,
      c.indirizzo,
      c.citta,
      c.cap,
      c.provincia,
      c.codice_fiscale,
      c.partita_iva,
      c.codice_sdi,
      c.cantiere_diverso,
      c.cantiere_indirizzo,
      c.cantiere_citta,
      c.cantiere_cap,
      c.cantiere_provincia,
      c.stato,
      c.data_richiamo,
      c.numero_contratto,
      c.data_firma_contratto,
      c.venditore_firma,
      c.importo_contratto,
      c.prodotti_venduti,
      c.note,
      u.nome_completo AS assegnato_a
    FROM customers c
    LEFT JOIN users u ON u.id = c.assegnato_a
    ORDER BY c.created_at DESC
  `).all();
  
  const headers = [
    'ID', 'Data Creazione', 'Nome', 'Cognome', 'Email', 'Telefono', 'Azienda',
    'Indirizzo', 'Città', 'CAP', 'Provincia', 'Codice Fiscale', 'Partita IVA', 'Codice SDI',
    'Cantiere Diverso', 'Cantiere Indirizzo', 'Cantiere Città', 'Cantiere CAP', 'Cantiere Provincia',
    'Stato', 'Data Richiamo', 'Numero Contratto', 'Data Firma Contratto', 'Venditore Firma',
    'Importo Contratto', 'Prodotti Venduti', 'Note', 'Assegnato A'
  ];
  
  const data = (rows.results || []).map((r: any) => [
    r.id, r.data_creazione, r.nome, r.cognome, r.email, r.telefono, r.azienda,
    r.indirizzo, r.citta, r.cap, r.provincia, r.codice_fiscale, r.partita_iva, r.codice_sdi,
    r.cantiere_diverso ? 'Sì' : 'No', r.cantiere_indirizzo, r.cantiere_citta, r.cantiere_cap, r.cantiere_provincia,
    r.stato, r.data_richiamo, r.numero_contratto, r.data_firma_contratto, r.venditore_firma,
    r.importo_contratto, r.prodotti_venduti, r.note, r.assegnato_a
  ]);
  
  const csv = toCSV(headers, data);
  const timestamp = new Date().toISOString().split('T')[0];
  
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="clienti_export_${timestamp}.csv"`
    }
  });
});

// 2. EXPORT APPUNTAMENTI
app.get('/api/export/appointments', async (c) => {
  await ensureInit(c.env.DB);
  
  const rows = await c.env.DB.prepare(`
    SELECT 
      a.id,
      a.data_ora,
      a.titolo,
      a.descrizione,
      a.stato,
      a.durata_min,
      a.contratto_chiuso,
      a.importo,
      a.prodotti_venduti,
      (cu.nome || ' ' || cu.cognome) AS cliente,
      cu.telefono AS cliente_telefono,
      cu.indirizzo AS cliente_indirizzo,
      cu.provincia,
      u.nome_completo AS venditore,
      a.created_at
    FROM appointments a
    LEFT JOIN customers cu ON cu.id = a.customer_id
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.data_ora DESC
  `).all();
  
  const headers = [
    'ID', 'Data/Ora', 'Titolo', 'Descrizione', 'Stato', 'Durata (min)',
    'Contratto Chiuso', 'Importo', 'Prodotti Venduti', 'Cliente', 'Tel Cliente',
    'Indirizzo', 'Provincia', 'Venditore', 'Creato Il'
  ];
  
  const data = (rows.results || []).map((r: any) => [
    r.id, r.data_ora, r.titolo, r.descrizione, r.stato, r.durata_min,
    r.contratto_chiuso ? 'Sì' : 'No', r.importo, r.prodotti_venduti,
    r.cliente, r.cliente_telefono, r.cliente_indirizzo, r.provincia,
    r.venditore, r.created_at
  ]);
  
  const csv = toCSV(headers, data);
  const timestamp = new Date().toISOString().split('T')[0];
  
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="appuntamenti_export_${timestamp}.csv"`
    }
  });
});

// 3. EXPORT PREVENTIVI
app.get('/api/export/preventivi', async (c) => {
  await ensureInit(c.env.DB);
  
  const rows = await c.env.DB.prepare(`
    SELECT 
      p.id,
      p.created_at,
      (c.nome || ' ' || c.cognome) AS cliente,
      c.telefono AS cliente_telefono,
      c.email AS cliente_email,
      p.priorita,
      p.stato,
      p.note_richiesta,
      ur.nome_completo AS richiedente,
      p.updated_at
    FROM preventivi p
    LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN users ur ON ur.id = p.richiedente_id
    ORDER BY p.created_at DESC
  `).all();
  
  const headers = [
    'ID', 'Data Richiesta', 'Cliente', 'Tel Cliente', 'Email Cliente',
    'Priorità', 'Stato', 'Note Richiesta', 'Richiedente', 'Ultimo Aggiornamento'
  ];
  
  const data = (rows.results || []).map((r: any) => [
    r.id, r.created_at, r.cliente, r.cliente_telefono, r.cliente_email,
    r.priorita, r.stato, r.note_richiesta, r.richiedente, r.updated_at
  ]);
  
  const csv = toCSV(headers, data);
  const timestamp = new Date().toISOString().split('T')[0];
  
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="preventivi_export_${timestamp}.csv"`
    }
  });
});

// 4. EXPORT VENDITE
app.get('/api/export/sales', async (c) => {
  await ensureInit(c.env.DB);
  
  const rows = await c.env.DB.prepare(`
    SELECT 
      s.id,
      s.numero_ordine,
      s.numero_contratto,
      s.data_vendita,
      s.totale,
      s.stato,
      (c.nome || ' ' || c.cognome) AS cliente,
      c.telefono AS cliente_telefono,
      c.indirizzo AS cliente_indirizzo,
      c.provincia,
      u.nome_completo AS venditore,
      s.note,
      s.created_at
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN users u ON u.id = s.user_id
    ORDER BY s.data_vendita DESC
  `).all();
  
  const headers = [
    'ID', 'N° Ordine', 'N° Contratto', 'Data Vendita', 'Totale €', 'Stato',
    'Cliente', 'Tel Cliente', 'Indirizzo', 'Provincia', 'Venditore', 'Note', 'Creato Il'
  ];
  
  const data = (rows.results || []).map((r: any) => [
    r.id, r.numero_ordine, r.numero_contratto, r.data_vendita, r.totale, r.stato,
    r.cliente, r.cliente_telefono, r.cliente_indirizzo, r.provincia,
    r.venditore, r.note, r.created_at
  ]);
  
  const csv = toCSV(headers, data);
  const timestamp = new Date().toISOString().split('T')[0];
  
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="vendite_export_${timestamp}.csv"`
    }
  });
});

// 5. EXPORT RILIEVI
app.get('/api/export/rilievi', async (c) => {
  await ensureInit(c.env.DB);
  
  const rows = await c.env.DB.prepare(`
    SELECT 
      r.id,
      r.created_at,
      (c.nome || ' ' || c.cognome) AS cliente,
      c.telefono AS cliente_telefono,
      c.indirizzo AS cliente_indirizzo,
      c.provincia,
      r.stato,
      r.data_rilievo,
      r.ora_rilievo,
      u.nome_completo AS tecnico,
      r.note,
      s.data_vendita AS data_contratto
    FROM rilievi r
    LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN users u ON u.id = r.tecnico_id
    LEFT JOIN sales s ON s.customer_id = r.customer_id
    ORDER BY s.data_vendita DESC NULLS LAST
  `).all();
  
  const headers = [
    'ID', 'Creato Il', 'Cliente', 'Tel Cliente', 'Indirizzo', 'Provincia',
    'Stato', 'Data Rilievo', 'Ora Rilievo', 'Tecnico', 'Note', 'Data Contratto'
  ];
  
  const data = (rows.results || []).map((r: any) => [
    r.id, r.created_at, r.cliente, r.cliente_telefono, r.cliente_indirizzo,
    r.provincia, r.stato, r.data_rilievo, r.ora_rilievo, r.tecnico, r.note,
    r.data_contratto
  ]);
  
  const csv = toCSV(headers, data);
  const timestamp = new Date().toISOString().split('T')[0];
  
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rilievi_export_${timestamp}.csv"`
    }
  });
});

// 6. EXPORT MONTAGGI
app.get('/api/export/montaggi', async (c) => {
  await ensureInit(c.env.DB);
  
  const rows = await c.env.DB.prepare(`
    SELECT 
      m.id,
      m.created_at,
      (c.nome || ' ' || c.cognome) AS cliente,
      c.telefono AS cliente_telefono,
      c.indirizzo AS cliente_indirizzo,
      c.provincia,
      m.prodotti_da_montare,
      m.stato,
      m.priorita,
      m.data_montaggio,
      m.ora_montaggio,
      m.montatori,
      m.note,
      o.numero_ordine
    FROM montaggi m
    LEFT JOIN orders o ON o.id = m.order_id
    LEFT JOIN customers c ON c.id = m.customer_id
    ORDER BY m.data_montaggio DESC NULLS LAST
  `).all();
  
  const headers = [
    'ID', 'Creato Il', 'Cliente', 'Tel Cliente', 'Indirizzo', 'Provincia',
    'Prodotti', 'Stato', 'Priorità', 'Data Montaggio', 'Ora Montaggio',
    'Montatori', 'Note', 'N° Ordine'
  ];
  
  const data = (rows.results || []).map((r: any) => [
    r.id, r.created_at, r.cliente, r.cliente_telefono, r.cliente_indirizzo,
    r.provincia, r.prodotti_da_montare, r.stato, r.priorita, r.data_montaggio,
    r.ora_montaggio, r.montatori, r.note, r.numero_ordine
  ]);
  
  const csv = toCSV(headers, data);
  const timestamp = new Date().toISOString().split('T')[0];
  
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="montaggi_export_${timestamp}.csv"`
    }
  });
});

// 7. EXPORT MASTER CLIENTI (tutti i dati correlati)
app.get('/api/export/customers/master', async (c) => {
  await ensureInit(c.env.DB);
  
  const customers = await c.env.DB.prepare(`
    SELECT 
      c.id,
      c.nome || ' ' || c.cognome AS cliente,
      c.telefono,
      c.email,
      c.indirizzo,
      c.citta,
      c.provincia,
      c.stato,
      c.data_firma_contratto,
      c.importo_contratto
    FROM customers c
    ORDER BY c.created_at DESC
  `).all();
  
  const rows: any[][] = [];
  
  for (const cust of (customers.results || [])) {
    const custId = (cust as any).id;
    
    // Appuntamenti
    const appts = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM appointments WHERE customer_id = ?
    `).bind(custId).first<{ count: number }>();
    
    // Preventivi
    const prevs = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM preventivi WHERE customer_id = ?
    `).bind(custId).first<{ count: number }>();
    
    // Vendite
    const sales = await c.env.DB.prepare(`
      SELECT COUNT(*) as count, SUM(totale) as totale FROM sales WHERE customer_id = ?
    `).bind(custId).first<{ count: number; totale: number }>();
    
    // Rilievi
    const rilievi = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM rilievi WHERE customer_id = ?
    `).bind(custId).first<{ count: number }>();
    
    // Montaggi
    const montaggi = await c.env.DB.prepare(`
      SELECT COUNT(*) as count FROM montaggi WHERE customer_id = ?
    `).bind(custId).first<{ count: number }>();
    
    rows.push([
      (cust as any).cliente,
      (cust as any).telefono,
      (cust as any).email,
      (cust as any).indirizzo,
      (cust as any).citta,
      (cust as any).provincia,
      (cust as any).stato,
      (cust as any).data_firma_contratto,
      (cust as any).importo_contratto,
      appts?.count || 0,
      prevs?.count || 0,
      sales?.count || 0,
      sales?.totale || 0,
      rilievi?.count || 0,
      montaggi?.count || 0
    ]);
  }
  
  const headers = [
    'Cliente', 'Telefono', 'Email', 'Indirizzo', 'Città', 'Provincia', 'Stato',
    'Data Contratto', 'Importo Contratto', 'N° Appuntamenti', 'N° Preventivi',
    'N° Vendite', 'Totale Vendite €', 'N° Rilievi', 'N° Montaggi'
  ];
  
  const csv = toCSV(headers, rows);
  const timestamp = new Date().toISOString().split('T')[0];
  
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="clienti_master_export_${timestamp}.csv"`
    }
  });
});
