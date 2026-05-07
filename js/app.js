/* ===== SUPABASE CLIENT ===== */
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ===== STATE ===== */
let currentSort = 'newest';
let currentSearch = '';
let currentAngkatan = 'all';
let selectedFile = null;
let currentUser = null;
let searchTimeout = null;

let userToken = localStorage.getItem('mn_user_token');
if (!userToken) {
  userToken = 'anon_' + Math.random().toString(36).slice(2) + Date.now();
  localStorage.setItem('mn_user_token', userToken);
}

/* ===== INIT ===== */
document.addEventListener('DOMContentLoaded', () => {
  loadUser();
  loadNotes();
  setupDropZone();
  setupSearch();
  setupSortDropdown();
  setupModalClose();
});

/* ===== HELPERS ===== */
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatSize(b) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileUrl(storedName) {
  const { data } = db.storage.from('uploads').getPublicUrl(storedName);
  return data.publicUrl;
}

/* ===== AUTH ===== */
function loadUser() {
  const saved = localStorage.getItem('mn_user');
  if (saved) {
    currentUser = JSON.parse(saved);
    userToken = currentUser.token;
    updateAuthUI();
  }
}

function updateAuthUI() {
  if (currentUser) {
    document.getElementById('authButtons').style.display = 'none';
    document.getElementById('userInfo').style.display = 'flex';
    document.getElementById('userBadge').textContent = '👤 ' + currentUser.username;
  } else {
    document.getElementById('authButtons').style.display = 'flex';
    document.getElementById('userInfo').style.display = 'none';
  }
}

function openAuthModal(type) {
  document.getElementById('authModal').classList.add('open');
  switchAuth(type);
}
function closeAuthModal() { document.getElementById('authModal').classList.remove('open'); }

function switchAuth(type) {
  document.getElementById('loginForm').style.display = type === 'login' ? 'block' : 'none';
  document.getElementById('registerForm').style.display = type === 'register' ? 'block' : 'none';
}

async function doLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!username || !password) return toast('Isi username dan password', 'error');

  try {
    const { data, error } = await db.rpc('login_user', {
      p_username: username,
      p_password: password
    });
    if (error) return toast('Gagal terhubung ke server', 'error');
    if (data.error) return toast(data.error, 'error');

    currentUser = data;
    userToken = data.token;
    localStorage.setItem('mn_user', JSON.stringify(data));
    localStorage.setItem('mn_user_token', userToken);
    updateAuthUI();
    closeAuthModal();
    toast('Selamat datang, ' + data.username + '! 👋', 'success');
  } catch { toast('Gagal terhubung ke server', 'error'); }
}

async function doRegister() {
  const username = document.getElementById('regUsername').value.trim();
  const password = document.getElementById('regPassword').value;
  if (!username || !password) return toast('Isi semua kolom', 'error');
  if (password.length < 6) return toast('Password minimal 6 karakter', 'error');

  try {
    const { data, error } = await db.rpc('register_user', {
      p_username: username,
      p_password: password
    });
    if (error) return toast('Gagal terhubung ke server', 'error');
    if (data.error) return toast(data.error, 'error');

    currentUser = data;
    userToken = data.token;
    localStorage.setItem('mn_user', JSON.stringify(data));
    localStorage.setItem('mn_user_token', userToken);
    updateAuthUI();
    closeAuthModal();
    toast('Akun berhasil dibuat! Selamat bergabung 🎉', 'success');
  } catch { toast('Gagal terhubung ke server', 'error'); }
}

function logout() {
  currentUser = null;
  localStorage.removeItem('mn_user');
  updateAuthUI();
  toast('Berhasil keluar', 'info');
}

/* ===== NOTES ===== */
async function loadNotes() {
  const grid = document.getElementById('notesGrid');
  grid.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Memuat catatan...</p></div>';

  try {
    let query = db.from('notes').select('*');

    if (currentAngkatan !== 'all') {
      query = query.eq('angkatan', currentAngkatan);
    }

    if (currentSearch) {
      query = query.or(
        `title.ilike.%${currentSearch}%,uploader_name.ilike.%${currentSearch}%,description.ilike.%${currentSearch}%`
      );
    }

    if (currentSort === 'likes') {
      query = query.order('likes', { ascending: false }).order('upload_date', { ascending: false });
    } else {
      query = query.order('upload_date', { ascending: false });
    }

    const { data: notes, error } = await query;
    if (error) throw error;
    renderNotes(notes);
  } catch {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Gagal memuat catatan. Periksa koneksi Supabase.</p></div>';
  }
}

function renderNotes(notes) {
  const grid = document.getElementById('notesGrid');
  const count = document.getElementById('noteCount');
  const title = document.getElementById('sectionTitle');

  count.textContent = notes.length + ' catatan';
  title.textContent = currentSort === 'likes' ? 'Paling Disukai' : currentSearch ? 'Hasil Pencarian' : 'Catatan Terbaru';

  if (notes.length === 0) {
    grid.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>Belum ada catatan. Jadilah yang pertama upload!</p></div>';
    return;
  }

  grid.innerHTML = '';
  notes.forEach((note, i) => {
    grid.appendChild(createNoteCard(note, i));
  });
}

function createNoteCard(note, index) {
  const card = document.createElement('div');
  card.className = `note-card type-${note.file_type}`;
  card.style.animationDelay = Math.min(index * 0.05, 0.3) + 's';

  const typeEmoji = { pdf: '📄', image: '🖼️', docx: '📝', txt: '📃' }[note.file_type] || '📁';
  const typeLabel = { pdf: 'PDF', image: 'Gambar', docx: 'Word Doc', txt: 'Teks' }[note.file_type] || 'File';
  const dateStr = new Date(note.upload_date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  const fileUrl = getFileUrl(note.stored_name);

  let thumbHtml = '';
if (note.file_type === 'image') {
  thumbHtml = `<div class="card-thumb">
    <img src="${note.file_url}" alt="${escHtml(note.title)}" loading="lazy" />
  </div>`;
} else if (note.file_type === 'pdf') {
  const canvasId = 'pdf-thumb-' + note.id;
  thumbHtml = `<div class="card-thumb pdf-thumb-wrap">
    <canvas id="${canvasId}" class="pdf-canvas"></canvas>
    <div class="pdf-thumb-loading" id="loading-${canvasId}">
      <div class="spinner-sm"></div>
    </div>
  </div>`;
  // Render PDF thumbnail setelah DOM siap
  setTimeout(() => renderPdfThumb(note.file_url, canvasId), 100);
} else {
  thumbHtml = `<div class="card-thumb">
    <span class="thumb-icon">${typeEmoji}</span>
  </div>`;
}

  card.innerHTML = `
    ${thumbHtml}
    <div class="card-badges">
      <div class="card-type-badge">${typeEmoji} ${typeLabel}</div>
      <div class="angkatan-badge ab-${note.angkatan}">'${note.angkatan}</div>
    </div>
    <div class="card-title">${escHtml(note.title)}</div>
    ${note.description ? `<div class="card-desc">${escHtml(note.description)}</div>` : ''}
    <div class="card-meta">
      <div class="card-meta-row">👤 <span class="card-uploader">${escHtml(note.uploader_name)}</span></div>
      <div class="card-meta-row">📅 ${dateStr} &nbsp;·&nbsp; 💾 ${formatSize(note.file_size)}</div>
    </div>
    <div class="card-actions">
      <button class="like-btn" id="like-${note.id}" onclick="toggleLike(event, '${note.id}')">
        <span class="heart">❤️</span> <span class="like-count">${note.likes}</span>
      </button>
      <button class="view-btn" onclick="openDetail('${note.id}')">Lihat →</button>
    </div>
  `;

  card.addEventListener('click', (e) => {
    if (!e.target.closest('.like-btn') && !e.target.closest('.view-btn')) {
      openDetail(note.id);
    }
  });

  checkLikeStatus(note.id);
  return card;
}

async function checkLikeStatus(noteId) {
  try {
    const { data } = await db.from('likes')
      .select('id')
      .eq('note_id', noteId)
      .eq('user_token', userToken)
      .maybeSingle();
    const btn = document.getElementById('like-' + noteId);
    if (btn && data) btn.classList.add('liked');
  } catch {}
}

async function toggleLike(e, noteId) {
  e.stopPropagation();
  const btn = document.getElementById('like-' + noteId);
  if (!btn) return;

  btn.disabled = true;
  try {
    const { data, error } = await db.rpc('toggle_like', {
      p_note_id: noteId,
      p_user_token: userToken
    });
    if (error) return toast('Gagal memproses like', 'error');

    btn.classList.toggle('liked', data.liked);
    btn.querySelector('.like-count').textContent = data.likes;

    const detailLikeBtn = document.getElementById('detail-like-btn');
    if (detailLikeBtn && detailLikeBtn.dataset.noteId === noteId) {
      detailLikeBtn.classList.toggle('liked', data.liked);
      detailLikeBtn.querySelector('.like-count').textContent = data.likes;
    }
  } catch { toast('Gagal memproses like', 'error'); }
  finally { btn.disabled = false; }
}

/* ===== DETAIL MODAL ===== */
async function openDetail(noteId) {
  const modal = document.getElementById('detailModal');
  const content = document.getElementById('detailContent');
  modal.classList.add('open');
  content.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Memuat detail...</p></div>';

  try {
    const [noteRes, likeRes] = await Promise.all([
      db.from('notes').select('*').eq('id', noteId).single(),
      db.from('likes').select('id').eq('note_id', noteId).eq('user_token', userToken).maybeSingle()
    ]);

    const note = noteRes.data;
    const liked = !!likeRes.data;

    const typeEmoji = { pdf: '📄', image: '🖼️', docx: '📝', txt: '📃' }[note.file_type] || '📁';
    const typeLabel = { pdf: 'PDF', image: 'Gambar', docx: 'Word Doc', txt: 'Teks' }[note.file_type] || 'File';
    const dateStr = new Date(note.upload_date).toLocaleDateString('id-ID', { dateStyle: 'long' });
    const fileUrl = getFileUrl(note.stored_name);

    let viewerHtml = '';
    if (note.file_type === 'pdf') {
      viewerHtml = `<div class="detail-viewer"><iframe src="${fileUrl}" title="${escHtml(note.title)}"></iframe></div>`;
    } else if (note.file_type === 'image') {
      viewerHtml = `<div class="detail-viewer"><img src="${fileUrl}" alt="${escHtml(note.title)}" /></div>`;
    } else if (note.file_type === 'txt') {
      viewerHtml = `<div class="detail-viewer"><iframe src="${fileUrl}" title="${escHtml(note.title)}"></iframe></div>`;
    } else {
      viewerHtml = `
        <div class="detail-viewer">
          <div class="no-preview">
            <div class="np-icon">${typeEmoji}</div>
            <p>Preview tidak tersedia untuk format ${typeLabel}.</p>
            <p style="font-size:13px;color:var(--text-dim);margin-top:8px;">Unduh file untuk membukanya.</p>
          </div>
        </div>`;
    }

    content.innerHTML = `
      <div class="detail-header">
        <div class="detail-type">
          <span class="card-type-badge">${typeEmoji} ${typeLabel}</span>
          <span class="angkatan-badge ab-${note.angkatan}">Angkatan '${note.angkatan}</span>
        </div>
        <h2 class="detail-title">${escHtml(note.title)}</h2>
        ${note.description ? `<p class="detail-desc">${escHtml(note.description)}</p>` : ''}
        <div class="detail-meta">
          <span>👤 ${escHtml(note.uploader_name)}</span>
          <span>📅 ${dateStr}</span>
          <span>💾 ${formatSize(note.file_size)}</span>
          <span>📄 ${escHtml(note.original_name)}</span>
        </div>
        <div class="detail-actions">
          <button class="like-btn ${liked ? 'liked' : ''}"
            id="detail-like-btn"
            data-note-id="${note.id}"
            onclick="toggleLike(event, '${note.id}')">
            <span class="heart">❤️</span> <span class="like-count">${note.likes}</span> Suka
          </button>
          <a href="${fileUrl}" download="${escHtml(note.original_name)}" class="download-btn">⬇ Unduh File</a>
        </div>
      </div>
      ${viewerHtml}
    `;
  } catch {
    content.innerHTML = '<div class="empty-state"><p>Gagal memuat detail catatan.</p></div>';
  }
}

function closeDetailModal() { document.getElementById('detailModal').classList.remove('open'); }

/* ===== UPLOAD ===== */
function openUploadModal() {
  document.getElementById('uploadModal').classList.add('open');
  if (currentUser) {
    document.getElementById('uploaderName').value = currentUser.username;
  }
}
function closeUploadModal() {
  document.getElementById('uploadModal').classList.remove('open');
  resetUploadForm();
}

function setupDropZone() {
  const zone = document.getElementById('dropZone');
  const input = document.getElementById('fileInput');

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFileSelect(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files[0]) handleFileSelect(input.files[0]); });
}

function handleFileSelect(file) {
  const maxSize = 10 * 1024 * 1024;
  const allowed = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'
  ];

  if (!allowed.includes(file.type)) return toast('Format tidak didukung. Gunakan PDF, DOCX, TXT, atau gambar.', 'error');
  if (file.size > maxSize) return toast('Ukuran file melebihi 10MB', 'error');

  selectedFile = file;
  const icon = {
    'application/pdf': '📄', 'text/plain': '📃',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝'
  }[file.type] || (file.type.startsWith('image/') ? '🖼️' : '📁');
  const size = file.size < 1024 * 1024 ? (file.size / 1024).toFixed(1) + ' KB' : (file.size / 1024 / 1024).toFixed(1) + ' MB';

  document.getElementById('filePrevIcon').textContent = icon;
  document.getElementById('filePrevName').textContent = file.name;
  document.getElementById('filePrevSize').textContent = size;
  document.getElementById('filePreview').style.display = 'flex';
  document.getElementById('dropZone').style.display = 'none';
}

function removeFile() {
  selectedFile = null;
  document.getElementById('fileInput').value = '';
  document.getElementById('filePreview').style.display = 'none';
  document.getElementById('dropZone').style.display = 'block';
}

async function submitUpload() {
  const name = document.getElementById('uploaderName').value.trim();
  const title = document.getElementById('noteTitle').value.trim();
  const desc = document.getElementById('noteDesc').value.trim();
  const angkatan = document.querySelector('input[name="angkatan"]:checked').value;

  if (!name) return toast('Masukkan namamu', 'error');
  if (!title) return toast('Masukkan judul catatan', 'error');
  if (!selectedFile) return toast('Pilih file untuk diupload', 'error');

  const btn = document.getElementById('uploadBtn');
  const progress = document.getElementById('uploadProgress');
  const fill = document.getElementById('progressFill');
  const progressText = document.getElementById('progressText');

  btn.disabled = true;
  btn.textContent = 'Mengupload...';
  progress.style.display = 'block';

  try {
    // Determine file type
    const ext = '.' + (selectedFile.name.split('.').pop() || '').toLowerCase();
    const mimeMap = {
      'application/pdf': 'pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
      'text/plain': 'txt'
    };
    const fileType = mimeMap[selectedFile.type] || (selectedFile.type.startsWith('image/') ? 'image' : 'other');

    // Generate unique filename
    const storedName = crypto.randomUUID() + ext;

    // Progress simulation
    let pct = 0;
    const progressInterval = setInterval(() => {
      pct = Math.min(pct + Math.random() * 20, 85);
      fill.style.width = pct + '%';
      progressText.textContent = 'Mengupload... ' + Math.round(pct) + '%';
    }, 200);

    // Upload file to Supabase Storage
    const { error: uploadError } = await db.storage
      .from('uploads')
      .upload(storedName, selectedFile, {
        contentType: selectedFile.type,
        upsert: false
      });

    if (uploadError) throw new Error('Gagal mengupload file: ' + uploadError.message);

    // Insert note record to database
    const { error: insertError } = await db.from('notes').insert({
      original_name: selectedFile.name,
      stored_name: storedName,
      file_size: selectedFile.size,
      file_type: fileType,
      mime_type: selectedFile.type,
      title: title,
      description: desc,
      uploader_name: name,
      angkatan: angkatan
    });

    clearInterval(progressInterval);

    if (insertError) throw new Error('Gagal menyimpan catatan: ' + insertError.message);

    fill.style.width = '100%';
    progressText.textContent = 'Upload selesai! ✓';

    setTimeout(() => {
      closeUploadModal();
      loadNotes();
      toast('Catatan berhasil diupload! 🎉', 'success');
    }, 600);
  } catch (err) {
    toast(err.message || 'Gagal mengupload file', 'error');
    progress.style.display = 'none';
    btn.disabled = false;
    btn.textContent = 'Upload Catatan ↗';
  }
}

function resetUploadForm() {
  document.getElementById('uploaderName').value = currentUser ? currentUser.username : '';
  document.getElementById('noteTitle').value = '';
  document.getElementById('noteDesc').value = '';
  document.getElementById('fileInput').value = '';
  const firstRadio = document.querySelector('input[name="angkatan"][value="23"]');
  if (firstRadio) firstRadio.checked = true;
  selectedFile = null;
  document.getElementById('filePreview').style.display = 'none';
  document.getElementById('dropZone').style.display = 'block';
  document.getElementById('uploadProgress').style.display = 'none';
  document.getElementById('uploadBtn').disabled = false;
  document.getElementById('uploadBtn').textContent = 'Upload Catatan ↗';
}

/* ===== ANGKATAN FILTER ===== */
function setAngkatan(angkatan) {
  currentAngkatan = angkatan;
  document.querySelectorAll('.angkatan-chip').forEach(c =>
    c.classList.toggle('active', c.dataset.angkatan === angkatan)
  );
  loadNotes();
}

/* ===== SEARCH ===== */
function setupSearch() {
  const input = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClear');

  input.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    const val = e.target.value;
    clearBtn.classList.toggle('visible', val.length > 0);
    currentSearch = val;
    searchTimeout = setTimeout(() => {
      if (val.length === 0 || val.length >= 2) loadNotes();
    }, 350);
  });
}

function clearSearch() {
  document.getElementById('searchInput').value = '';
  document.getElementById('searchClear').classList.remove('visible');
  currentSearch = '';
  loadNotes();
}

/* ===== SORT ===== */
function setupSortDropdown() {
  const btn = document.getElementById('sortBtn');
  const dd = document.getElementById('sortDropdown');
  btn.addEventListener('click', (e) => { e.stopPropagation(); dd.classList.toggle('open'); });
  document.addEventListener('click', () => dd.classList.remove('open'));
}

function setSortAndClose(sort) {
  currentSort = sort;
  document.querySelectorAll('.sort-opt').forEach(b => b.classList.toggle('active', b.dataset.sort === sort));
  document.getElementById('sortDropdown').classList.remove('open');
  loadNotes();
}

/* ===== MODAL CLOSE ===== */
function setupModalClose() {
  ['uploadModal', 'authModal', 'detailModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', (e) => {
      if (e.target.id === id) {
        if (id === 'uploadModal') closeUploadModal();
        else if (id === 'authModal') closeAuthModal();
        else if (id === 'detailModal') closeDetailModal();
      }
    });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeUploadModal(); closeAuthModal(); closeDetailModal();
    }
  });
}

/* ===== TOAST ===== */
function toast(message, type = 'info') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const container = document.getElementById('toastContainer');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]}</span> ${escHtml(message)}`;
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-fade');
    t.addEventListener('animationend', () => t.remove());
  }, 3500);
}
/* ===== PDF THUMBNAIL RENDERER ===== */
async function renderPdfThumb(fileUrl, canvasId) {
  const canvas = document.getElementById(canvasId);
  const loading = document.getElementById('loading-' + canvasId);
  if (!canvas) return;

  try {
    // Load PDF.js dari CDN
    if (!window.pdfjsLib) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      window.pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const pdf = await window.pdfjsLib.getDocument(fileUrl).promise;
    const page = await pdf.getPage(1);

    const viewport = page.getViewport({ scale: 1 });
    const thumbWidth = 320;
    const scale = thumbWidth / viewport.width;
    const scaledViewport = page.getViewport({ scale });

    canvas.width = scaledViewport.width;
    canvas.height = scaledViewport.height;

    await page.render({
      canvasContext: canvas.getContext('2d'),
      viewport: scaledViewport
    }).promise;

    if (loading) loading.style.display = 'none';
    canvas.style.opacity = '1';
  } catch (err) {
    // Fallback ke ikon jika gagal
    if (canvas && canvas.parentElement) {
      canvas.parentElement.innerHTML = '<span class="thumb-icon">📄</span>';
    }
  }
}
/* ===== ROUTER ===== */
function router(page) {
  if (page === 'home') {
    currentSearch = '';
    currentAngkatan = 'all';
    document.getElementById('searchInput').value = '';
    document.querySelectorAll('.angkatan-chip').forEach(c =>
      c.classList.toggle('active', c.dataset.angkatan === 'all')
    );
    loadNotes();
  }
}
