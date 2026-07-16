/* ─── 全域狀態 ───────────────────────────── */
const API_BASE = 'https://line-bot.eletang.com.tw';
const OA_BASIC_ID = '@868lgvsq';
const OA_ADD_FRIEND_URL = `https://line.me/R/ti/p/${OA_BASIC_ID}`;

let userId = '';
let currentUrl = '';
let currentCourse = null;
let currentTags = [];
let tagsConfirmed = false;
let tagsEdited = false;
let selectedRating = null;
let selectedScore = null;
let pendingToken = '';
let pollTimer = null;

/* ─── 工具函式 ──────────────────────────── */
function $(id) { return document.getElementById(id); }
function show(id) { $(id).style.display = ''; }
function hide(id) { $(id).style.display = 'none'; }
function showBlock(id) { $(id).style.display = 'block'; }

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function showError(msg) {
  const el = $('url-error');
  el.textContent = msg;
  el.classList.add('show');
}

function hideError() {
  $('url-error').classList.remove('show');
}

async function apiPost(path, body) {
  const r = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ detail: `HTTP ${r.status}` }));
    throw new Error(err.detail || `HTTP ${r.status}`);
  }
  return r.json();
}

/* ─── 頁面初始化 ─────────────────────────── */
async function initPage() {
  // 嘗試從 LIFF SDK 取得 userId
  try {
    if (typeof liff !== 'undefined') {
      await liff.init({ liffId: '2006684025-pPLBowmb' });
      if (liff.isLoggedIn()) {
        const profile = await liff.getProfile();
        if (profile.userId) {
          userId = profile.userId;
          localStorage.setItem('liff_user_id', userId);
        }
      }
    }
  } catch (e) {
    // LIFF init 失敗，降級到 localStorage
  }

  // 嘗試從 localStorage 恢復 userId（已完成驗證的好友或 LIFF fallback）
  const savedId = localStorage.getItem('liff_user_id');
  if (savedId && !userId) {
    userId = savedId;
  }

  const params = new URLSearchParams(window.location.search);
  const continueToken = params.get('continue');
  if (continueToken) {
    await handleContinueToken(continueToken);
    return;
  }
  loadStats();
}

async function handleContinueToken(token) {
  show('loading');
  $('loading-text').textContent = '正在完成評價...';
  try {
    const d = await apiPost('/api/liff/complete-pending', { continue_token: token });
    if (d.success && d.user_id) {
      userId = d.user_id;
      // 儲存 userId，下次從選單進來直接帶入
      if (userId) localStorage.setItem('liff_user_id', userId);
      if (d.already_rated) {
        hide('loading');
        showBlock('already-rated');
        $('already-rated').textContent = 'ℹ️ 你已評價過這門課程了 🙏';
        loadStats();
        return;
      }
      if (d.total_score !== undefined) {
        hide('loading');
        showBlock('rating-result');
        $('rating-result').style.display = 'block';
        let html = `<div style="font-size:18px;margin-bottom:8px">✅ 評價已完成！</div>`;
        if (d.points_earned) {
          html += `<div style="margin-top:6px;font-size:14px;color:#f59e0b">🎯 +${d.points_earned} 點數獲得！（累計 ${d.total_points} 點）</div>`;
        }
        html += `<div style="margin-top:8px;border-top:1px solid #ccc;padding-top:8px;font-size:13px;color:#888">
            📊 目前累計 <strong>${d.rating_count}</strong> 次評價，總評分 <strong>${d.total_score}</strong> 點
          </div>`;
        $('rating-result').innerHTML = html;
        clearUrlInput();
        loadStats();
        window.history.replaceState({}, '', '/');
        return;
      }
      hide('loading');
      window.history.replaceState({}, '', '/');
      loadStats();
    } else {
      hide('loading');
      showError('無法完成評價，請重新操作');
    }
  } catch (e) {
    hide('loading');
    showError(e.message || '處理繼續連結失敗');
  }
}

/* ─── 平台列表彈窗 ───────────────────────── */
async function showPlatformList() {
  const overlay = $('platform-modal-overlay');
  const body = $('platform-list-body');
  body.innerHTML = '<div class="modal-empty">載入中...</div>';
  overlay.style.display = 'flex';
  try {
    const d = await apiPost('/api/liff/platform-list');
    if (!d.platforms || d.platforms.length === 0) {
      body.innerHTML = '<div class="modal-empty">📭 暫無平台資料</div>';
      return;
    }
    body.innerHTML = `<div class="platform-list">${d.platforms.map(p =>
      `<div class="platform-item">📍 ${escapeHtml(p)}</div>`
    ).join('')}</div>`;
  } catch (e) {
    body.innerHTML = '<div class="modal-empty">❌ 載入失敗</div>';
  }
}

function closePlatformList() {
  $('platform-modal-overlay').style.display = 'none';
}

/* ─── 載入統計資料 ──────────────────────── */
async function loadStats() {
  try {
    const d = await apiPost('/api/liff/user-stats', { user_id: userId });
    safeText('stat-total', d.total_courses);
    safeText('stat-rated', d.user_rated_count);
    safeText('stat-points', d.user_points);
  } catch (e) {
    safeText('stat-total', '?');
    safeText('stat-rated', '?');
    safeText('stat-points', '?');
  }
}
function safeText(id, val) {
  const el = document.getElementById(id);
  if (!el) return;
  if (typeof val === 'number') {
    el.textContent = val.toLocaleString();
  } else {
    el.textContent = val != null ? String(val) : '0';
  }
}

/* ─── 評價歷史彈窗 ───────────────────────── */
async function showRatedList() {
  if (!userId) {
    showError('請先完成一次評價後再查看歷史記錄');
    return;
  }
  const overlay = $('rated-modal-overlay');
  const body = $('rated-list-body');
  body.innerHTML = '<div class="modal-empty">載入中...</div>';
  overlay.style.display = 'flex';
  try {
    const d = await apiPost('/api/liff/user-ratings', { user_id: userId });
    if (!d.ratings || d.ratings.length === 0) {
      body.innerHTML = '<div class="modal-empty">📭 尚未評價任何課程</div>';
      return;
    }
    body.innerHTML = d.ratings.map(r => {
      const score = r.rating_score || 0;
      let emoji = '📝';
      if (score <= -8) emoji = '🎉';
      else if (score <= -3) emoji = '✅';
      else if (score <= 7) emoji = '⚠️';
      else emoji = '💥';
      const reviewHtml = r.review_text ? `<div class="rated-item-review">${escapeHtml(r.review_text)}</div>` : '';
      return `
        <div class="rated-item">
          <div class="rated-item-emoji">${emoji}</div>
          <div class="rated-item-content">
            <div class="rated-item-title">${escapeHtml(r.course_title || r.course_url || '未知課程')}</div>
            <div class="rated-item-meta">${r.label || score} · ${r.created_at ? r.created_at.slice(0, 10) : ''}</div>
            ${reviewHtml}
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    body.innerHTML = '<div class="modal-empty">❌ 載入失敗</div>';
  }
}

function closeRatedList() {
  $('rated-modal-overlay').style.display = 'none';
}

/* ─── 點數彈窗 ──────────────────────────── */
async function showPointList() {
  if (!userId) {
    showError('請先完成一次評價後再查看點數');
    return;
  }
  const overlay = $('points-modal-overlay');
  const body = $('points-list-body');
  body.innerHTML = '<div class="modal-empty">載入中...</div>';
  overlay.style.display = 'flex';
  try {
    const d = await apiPost('/api/liff/user-points', { user_id: userId });
    const total = d.total_points || 0;
    let html = `<div style="text-align:center;padding:16px 0">
      <div style="font-size:42px;margin-bottom:4px">🎯</div>
      <div style="font-size:28px;font-weight:700;color:#1a3a5c">${total.toLocaleString()}</div>
      <div style="font-size:13px;color:#888;margin-top:2px">累計點數</div>
    </div>`;
    if (!d.transactions || d.transactions.length === 0) {
      html += '<div class="modal-empty">📭 尚無點數交易紀錄<br><span style="font-size:12px;color:#999">去評價課程賺點數吧！</span></div>';
    } else {
      html += '<div style="margin-top:8px;border-top:1px solid #eee;padding-top:8px"><div style="font-size:13px;color:#555;margin-bottom:6px">📋 最近交易</div>';
      html += d.transactions.map(t => {
        const sign = t.points > 0 ? '+' : '';
        const color = t.points > 0 ? '#22c55e' : '#ef4444';
        const reason = t.reason === 'course_review' ? '📝 課程評價' : (t.reason ? '🔙 ' + escapeHtml(t.reason) : '-');
        return `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f5f5f5;font-size:13px">
          <span style="color:#555">${reason}</span>
          <span style="font-weight:600;color:${color}">${sign}${t.points}</span>
        </div>`;
      }).join('');
      html += '</div>';
    }
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = '<div class="modal-empty">❌ 載入失敗</div>';
  }
}
function closePointList() {
  $('points-modal-overlay').style.display = 'none';
}

/* ─── 查詢課程 ───────────────────────────── */
async function checkUrl() {
  hideError();
  hide('course-card');
  hide('already-rated');
  hide('rating-section');
  hide('tags-section');
  hide('non-friend-panel');
  hide('verify-code-area');
  hide('email-input-group');
  hide('rating-result');
  $('rating-result').style.display = 'none';

  const url = $('course-url').value.trim();
  if (!url) { showError('請輸入課程網址'); return; }
  if (!url.startsWith('http://') && !url.startsWith('https://')) { showError('網址需以 http:// 或 https:// 開頭'); return; }

  show('loading');
  $('loading-text').textContent = '正在查詢知識庫...';
  $('check-btn').disabled = true;
  selectedRating = null;
  selectedScore = null;

  try {
    const d = await apiPost('/api/liff/check-url', { url, user_id: userId });
    currentUrl = url;
    currentCourse = d;
    hide('loading');

    if (d.already_rated) {
      showBlock('already-rated');
      $('already-rated').innerHTML = `ℹ️ 你已評價過「${escapeHtml(d.title || '此課程')}」了 🙏`;
      $('check-btn').disabled = false;
      return;
    }

    if (!d.can_rate) {
      if (d.reason === 'not_a_course') {
        $('url-error').textContent = '❌ 系統無法判定此網址為有效課程頁面，請確認網址後再試。';
        $('url-error').classList.add('show');
      } else {
        showError(d.reason || '無法處理此網址');
      }
      $('check-btn').disabled = false;
      return;
    }

    show('course-card');
    $('course-platform').textContent = d.platform || '未知平台';
    $('course-title').textContent = d.title || '未知課程';
    $('course-instructor').textContent = d.instructor || '未標示';
    $('course-price').textContent = d.price || '未標示';
    $('course-desc').textContent = (d.description || '').slice(0, 150);

    let statusText = '';
    if (d.action === 'added') statusText = '✅ 新加入知識庫';
    else if (d.action === 'exists') statusText = '📚 已在知識庫';
    $('course-status').textContent = statusText;

    if (d.is_research || !d.action) {
      const existing = document.querySelector('.research-card');
      if (!existing) {
        const card = document.createElement('div');
        card.className = 'research-card';
        card.innerHTML = `<div class="research-card-desc">此網站課程尚未收錄，您仍可繼續評價。</div>`;
        $('course-card').after(card);
      }
    }

    // 顯示標籤
    currentTags = d.tags || [];
    tagsConfirmed = false;
    tagsEdited = false;
    renderTags(d.tags || [], d.action === 'exists');

    show('rating-section');
    $('rating-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (e) {
    hide('loading');
    showError(e.message || '查詢課程時發生錯誤');
  }
  $('check-btn').disabled = false;
}

/* ─── 選擇評價等級 ────────────────────────── */
function selectRating(label, score) {
  document.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('selected'));
  for (const btn of document.querySelectorAll('.rating-btn')) {
    if (btn.textContent.includes(label)) {
      btn.classList.add('selected');
      break;
    }
  }
  selectedRating = label;
  selectedScore = score;
  $('submit-rating-btn').disabled = false;
  $('submit-rating-btn').textContent = `送出評價：${label}`;
}

/* ─── 清空網址欄位 ─────────────────────── */
function clearUrlInput() {
  $('course-url').value = '';
  currentUrl = '';
  currentCourse = null;
  currentTags = [];
  tagsConfirmed = false;
  tagsEdited = false;
  selectedRating = null;
  selectedScore = null;
  hide('course-card');
  hide('already-rated');
  hide('rating-section');
  hide('tags-section');
  hide('non-friend-panel');
  hide('verify-code-area');
  hide('email-input-group');
  document.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('selected'));
  $('submit-rating-btn').disabled = true;
  $('submit-rating-btn').textContent = '送出評價';
}

/* ─── 送出評價 ───────────────────────────── */
async function submitRating() {
  if (!selectedRating || selectedScore === null || !currentUrl) return;

  $('submit-rating-btn').disabled = true;
  $('submit-rating-btn').textContent = '送出中...';
  hide('rating-result');
  $('rating-result').style.display = 'none';
  hide('non-friend-panel');
  hide('verify-code-area');
  hide('email-input-group');

  const reviewText = $('review-text').value.trim();

  try {
    const d = await apiPost('/api/liff/submit-rating', {
      url: currentUrl,
      user_id: userId,
      rating_score: selectedScore,
      rating_label: selectedRating,
      review_text: reviewText,
    });

    if (d.pending) {
      pendingToken = d.pending_token;
      // 顯示警告 + 選擇：加入好友 / Email
      show('non-friend-panel');
      $('non-friend-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
      // 暫存驗證碼（等用戶點加入再顯示）
      sessionStorage.setItem('liff_pending_token', pendingToken);
      sessionStorage.setItem('liff_verify_code', d.verify_code);
      $('submit-rating-btn').disabled = false;
      $('submit-rating-btn').textContent = '重新送出';
      return;
    }

    showRatingSuccess(d);
    clearUrlInput();
  } catch (e) {
    $('submit-rating-btn').disabled = false;
    $('submit-rating-btn').textContent = '重新送出';
    showError(e.message || '送出評價失敗');
  }
}

/* ─── 驗證碼流程 ─────────────────────────── */
function showVerifyCode(code) {
  hide('non-friend-panel');
  show('verify-code-area');
  $('verify-code').textContent = code;
  $('verify-code').style.display = '';

  // 建立 LINE oaMessage 連結：自動填入驗證碼
  const lineMsgUrl = `https://line.me/R/oaMessage/${OA_BASIC_ID}/?${encodeURIComponent(code)}`;
  $('verify-line-link').href = lineMsgUrl;

  // 偵測是否為桌面版 → 顯示 QR Code
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  const qrSection = $('verify-qr-section');
  if (isMobile) {
    qrSection.style.display = 'none';
  } else {
    qrSection.style.display = '';
    $('verify-qr-img').src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(lineMsgUrl)}`;
  }

  $('verify-status').textContent = '等待 LINE 驗證中...';
  $('verify-status').className = 'verify-status pending';

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollPendingStatus, 3000);
}

async function pollPendingStatus() {
  if (!pendingToken) return;
  try {
    const d = await apiPost('/api/liff/check-pending-status', { pending_token: pendingToken });
    if (d.completed) {
      clearInterval(pollTimer);
      pollTimer = null;
      hide('verify-code-area');
      userId = d.user_id || '';
      if (userId) localStorage.setItem('liff_user_id', userId);
      if (d.already_rated) {
        showBlock('already-rated');
        $('already-rated').innerHTML = `ℹ️ 你已評價過此課程了 🙏`;
        loadStats();
        clearUrlInput();
        return;
      }
      showRatingSuccess(d);
      clearUrlInput();
    }
  } catch (e) {
    // 忽略輪詢錯誤
  }
}

function copyVerifyCode() {
  const code = $('verify-code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    $('verify-copy-btn').textContent = '✅ 已複製！';
    setTimeout(() => { $('verify-copy-btn').textContent = '📋 複製驗證碼'; }, 2000);
  });
}

function showEmailOption() {
  hide('non-friend-panel');
  hide('verify-code-area');
  show('email-input-group');
  $('email-input-group').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showVerifyCodePanel() {
  // 從 sessionStorage 取出驗證碼
  const code = sessionStorage.getItem('liff_verify_code');
  pendingToken = sessionStorage.getItem('liff_pending_token') || pendingToken;
  if (code && pendingToken) {
    hide('non-friend-panel');
    showVerifyCode(code);
  } else {
    showError('評價資料已過期，請重新操作');
  }
}

async function submitEmailRating() {
  const email = $('email-input').value.trim();
  if (!email || !email.includes('@')) {
    showError('請輸入有效的 Email');
    return;
  }
  hideError();
  $('email-submit-btn').disabled = true;
  $('email-submit-btn').textContent = '送出中...';

  try {
    const d = await apiPost('/api/liff/submit-rating', {
      url: currentUrl,
      user_id: `email:${email}`,
      rating_score: selectedScore,
      rating_label: selectedRating,
      review_text: $('review-text').value.trim(),
    });
    if (d.success) {
      userId = `email:${email}`;
      localStorage.setItem('liff_user_id', userId);
      showRatingSuccess(d);
      hide('email-input-group');
      clearUrlInput();
    }
  } catch (e) {
    $('email-submit-btn').disabled = false;
    $('email-submit-btn').textContent = '使用 Email 送出';
    showError(e.message || '送出失敗');
  }
}

/* ─── 顯示評價成功 ───────────────────────── */
function showRatingSuccess(d) {
  showBlock('rating-result');
  $('rating-result').style.display = 'block';
  const emojis = { '收獲很大': '🎉', '不雷': '✅', '有點雷': '⚠️', '爆雷': '💥' };
  const emoji = emojis[selectedRating] || '📝';
  let html = `
    <div style="font-size:18px;margin-bottom:8px">✅ 評價完成！</div>
    <div>${emoji} ${selectedRating}</div>
    <div style="margin-top:4px;color:#555">📚 ${escapeHtml(currentCourse?.title || '').slice(0, 40)}</div>`;
  if (d.points_earned) {
    html += `<div style="margin-top:6px;font-size:14px;color:#f59e0b">🎯 +${d.points_earned} 點數獲得！（累計 ${d.total_points} 點）</div>`;
  }
  if (d.total_score !== undefined) {
    html += `<div style="margin-top:8px;border-top:1px solid #ccc;padding-top:8px;font-size:13px;color:#888">
      📊 目前累計 <strong>${d.rating_count}</strong> 次評價，總評分 <strong>${d.total_score}</strong> 點</div>`;
  }
  $('rating-result').innerHTML = html;
  loadStats();

  $('review-text').value = '';
  $('submit-rating-btn').textContent = '送出評價';
  selectedRating = null;
  selectedScore = null;
  document.querySelectorAll('.rating-btn').forEach(b => b.classList.remove('selected'));
  $('rating-section').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ─── 標籤渲染 ──────────────────────────── */
function renderTags(tags, readOnly) {
  const container = $('tags-section');
  const list = $('tags-list');
  const prompt = $('tags-prompt');
  const actions = $('tags-actions');
  const editArea = $('tags-editing');
  const confirmedMsg = $('tags-confirmed-msg');

  if (!tags || tags.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = '';
  prompt.style.display = readOnly ? 'none' : '';
  confirmedMsg.style.display = 'none';

  list.innerHTML = tags.map((t, i) => {
    if (readOnly) {
      return `<span class="tag-pill tag-readonly">${escapeHtml(t)}</span>`;
    }
    return `<span class="tag-pill">${escapeHtml(t)}<span class="tag-remove" onclick="removeTag(${i})">&times;</span></span>`;
  }).join('');

  if (readOnly) {
    actions.style.display = 'none';
    editArea.style.display = 'none';
  } else {
    actions.style.display = tagsConfirmed ? 'none' : '';
    editArea.style.display = 'none';
  }
}

/* ─── 確認標籤 ──────────────────────────── */
async function confirmTags() {
  hideError();
  $('tags-confirm-btn').disabled = true;
  $('tags-confirm-btn').textContent = '儲存中...';
  try {
    await apiPost('/api/liff/confirm-tags', {
      url: currentUrl,
      user_id: userId,
      tags: currentTags,
    });
    tagsConfirmed = true;
    $('tags-actions').style.display = 'none';
    $('tags-confirmed-msg').style.display = '';
    $('tags-editing').style.display = 'none';
  } catch (e) {
    showError(e.message || '儲存標籤失敗');
  }
  $('tags-confirm-btn').disabled = false;
  $('tags-confirm-btn').textContent = '✅ 標籤正確';
}

/* ─── 切換編輯模式 ──────────────────────── */
function toggleEditTags() {
  const editArea = $('tags-editing');
  editArea.style.display = editArea.style.display === 'none' ? '' : 'none';
  if (editArea.style.display !== 'none') {
    $('tag-input').focus();
  }
}

/* ─── 新增標籤 ──────────────────────────── */
function addTag() {
  const input = $('tag-input');
  const val = input.value.trim();
  if (!val) return;
  if (currentTags.includes(val)) {
    showError(`標籤「${val}」已存在`);
    return;
  }
  currentTags.push(val);
  renderTags(currentTags, false);
  input.value = '';
  input.focus();
}

/* ─── 移除標籤 ──────────────────────────── */
function removeTag(index) {
  currentTags.splice(index, 1);
  if (currentTags.length === 0) {
    hide('tags-section');
    return;
  }
  renderTags(currentTags, false);
}

/* ─── Enter 快速查詢 ────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  $('course-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); checkUrl(); }
  });
  initPage();
});
