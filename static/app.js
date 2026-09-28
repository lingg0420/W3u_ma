const DATABASE_NAME = 'good-food-diary';
const DATABASE_VERSION = 1;
const STORE_NAME = 'records';
const CUISINES = ['日式料理', '台式料理', '韓式料理', '義式料理', '中式料理', '美式料理', '泰式料理', '越式料理', '其他'];
const CHART_COLORS = ['#e7795e', '#6f9d7d', '#e5b84e', '#7196a7', '#a789b5', '#d69b62', '#7f9b58', '#d47a8a', '#98a2a5'];

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runStoreRequest(mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(transaction.error); };
    transaction.onabort = () => { db.close(); reject(transaction.error); };
  });
}

const getAllRecords = () => runStoreRequest('readonly', (store) => store.getAll());
const getRecord = (id) => runStoreRequest('readonly', (store) => store.get(Number(id)));
const putRecord = (record) => runStoreRequest('readwrite', (store) => store.put(record));
const deleteRecord = (id) => runStoreRequest('readwrite', (store) => store.delete(Number(id)));

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function showMessage(message, kind = 'error') {
  let stack = document.querySelector('.flash-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.className = 'flash-stack';
    document.querySelector('.page-content').prepend(stack);
  }
  const notice = document.createElement('div');
  notice.className = `flash ${kind}`;
  notice.setAttribute('role', 'status');
  notice.textContent = message;
  stack.replaceChildren(notice);
}

function makeFoodCard(record) {
  const card = document.createElement('article');
  card.className = 'food-card';
  if (record.image) {
    const image = document.createElement('img');
    image.className = 'food-photo';
    image.src = URL.createObjectURL(record.image);
    image.alt = record.food_name;
    image.loading = 'lazy';
    card.append(image);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'food-photo photo-placeholder';
    const caption = document.createElement('span');
    caption.textContent = '今日好味';
    const initial = document.createElement('b');
    initial.textContent = record.food_name.slice(0, 1);
    placeholder.append(caption, initial);
    card.append(placeholder);
  }

  const body = document.createElement('div');
  body.className = 'food-card-body';
  const titleRow = document.createElement('div');
  titleRow.className = 'food-title-row';
  const title = document.createElement('h3');
  title.textContent = record.food_name;
  const edit = document.createElement('a');
  edit.className = 'edit-link';
  edit.href = `/edit/${record.id}`;
  edit.textContent = '編輯';
  edit.setAttribute('aria-label', `編輯${record.food_name}`);
  titleRow.append(title, edit);

  const meta = document.createElement('p');
  meta.className = 'food-meta';
  meta.append(document.createTextNode(`${record.meal_type} · ${record.cuisine_type} `));
  const time = document.createElement('time');
  time.textContent = new Date(record.eaten_at).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  meta.append(time);
  body.append(titleRow, meta);

  if (record.tags.length) {
    const tags = document.createElement('div');
    tags.className = 'tag-list';
    record.tags.forEach((tag) => {
      const item = document.createElement('span');
      item.textContent = `#${tag}`;
      tags.append(item);
    });
    body.append(tags);
  }
  if (record.note) {
    const note = document.createElement('p');
    note.className = 'food-note';
    note.textContent = record.note;
    body.append(note);
  }

  const deleteRow = document.createElement('div');
  deleteRow.className = 'delete-form';
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'text-button';
  remove.textContent = '刪除紀錄';
  remove.addEventListener('click', async () => {
    if (!window.confirm('確定刪除這筆紀錄嗎？')) return;
    try {
      await deleteRecord(record.id);
      await renderCurrentPage();
      showMessage('飲食紀錄已刪除。', 'success');
    } catch {
      showMessage('刪除失敗，請稍後再試。');
    }
  });
  deleteRow.append(remove);
  body.append(deleteRow);
  card.append(body);
  return card;
}

async function renderHome(records) {
  const today = localDateKey(new Date());
  const todaysRecords = records.filter((record) => record.date_key === today);
  const container = document.querySelector('#today-records');
  container.replaceChildren(...todaysRecords.map(makeFoodCard));
  document.querySelector('#today-count').textContent = String(todaysRecords.length);
  document.querySelector('#today-empty').hidden = todaysRecords.length > 0;
}

async function renderCalendar(records) {
  const params = new URLSearchParams(window.location.search);
  const year = Number(params.get('year')) || new Date().getFullYear();
  const month = Number(params.get('month')) || new Date().getMonth() + 1;
  const selectedDay = params.get('day');
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const monthly = records.filter((record) => record.date_key.startsWith(prefix));
  const counts = new Map();
  monthly.forEach((record) => counts.set(record.date_key.slice(-2), (counts.get(record.date_key.slice(-2)) || 0) + 1));
  document.querySelectorAll('.day-cell[data-day]').forEach((cell) => {
    const count = counts.get(String(cell.dataset.day).padStart(2, '0')) || 0;
    const marker = cell.querySelector('i');
    marker.hidden = count === 0;
    marker.title = count ? `${count} 餐` : '';
    cell.classList.toggle('has-records', count > 0);
  });
  if (selectedDay) {
    const dateKey = `${prefix}${String(selectedDay).padStart(2, '0')}`;
    const selected = monthly.filter((record) => record.date_key === dateKey);
    document.querySelector('#selected-count').textContent = String(selected.length);
    document.querySelector('#selected-records').replaceChildren(...selected.map(makeFoodCard));
    document.querySelector('#selected-empty').hidden = selected.length > 0;
  }
}

function renderStatistics(records) {
  const params = new URLSearchParams(window.location.search);
  const year = Number(params.get('year')) || new Date().getFullYear();
  const month = Number(params.get('month')) || new Date().getMonth() + 1;
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const monthly = records.filter((record) => record.date_key.startsWith(prefix));
  const cuisineCounts = new Map();
  const tagCounts = new Map();
  monthly.forEach((record) => {
    cuisineCounts.set(record.cuisine_type, (cuisineCounts.get(record.cuisine_type) || 0) + 1);
    record.tags.forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1));
  });
  const cuisines = [...cuisineCounts.entries()].sort((a, b) => b[1] - a[1] || CUISINES.indexOf(a[0]) - CUISINES.indexOf(b[0]));
  const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  document.querySelector('#month-total').textContent = String(monthly.length);
  document.querySelector('#pie-total').textContent = String(monthly.length);
  document.querySelector('#cuisine-kind-count').textContent = String(cuisines.length);
  document.querySelector('#cuisine-empty').hidden = cuisines.length > 0;
  document.querySelector('#tags-empty').hidden = tags.length > 0;

  let angle = 0;
  const gradient = cuisines.map(([name, count], index) => {
    const end = angle + count / monthly.length * 100;
    const part = `${CHART_COLORS[index % CHART_COLORS.length]} ${angle}% ${end}%`;
    angle = end;
    return part;
  });
  document.querySelector('#pie-chart').style.background = gradient.length ? `conic-gradient(${gradient.join(', ')})` : 'conic-gradient(#e8ece8 0 100%)';
  const legend = document.querySelector('#cuisine-legend');
  legend.replaceChildren(...cuisines.map(([name, count], index) => {
    const row = document.createElement('div');
    row.className = 'cuisine-row';
    const swatch = document.createElement('i');
    swatch.style.setProperty('--swatch', CHART_COLORS[index % CHART_COLORS.length]);
    const label = document.createElement('span');
    label.textContent = name;
    const number = document.createElement('strong');
    number.textContent = `${count}次`;
    const percentage = document.createElement('b');
    percentage.textContent = `${(count / monthly.length * 100).toFixed(1)}%`;
    row.append(swatch, label, number, percentage);
    return row;
  }));

  const popular = document.querySelector('#popular-tags');
  popular.replaceChildren(...tags.map(([name, count], index) => {
    const row = document.createElement('li');
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = String(index + 1).padStart(2, '0');
    const label = document.createElement('span');
    label.className = 'popular-name';
    label.textContent = `#${name}`;
    const track = document.createElement('span');
    track.className = 'popular-track';
    const bar = document.createElement('i');
    bar.style.width = `${count / tags[0][1] * 100}%`;
    track.append(bar);
    const total = document.createElement('strong');
    total.textContent = `${count}次`;
    row.append(rank, label, track, total);
    return row;
  }));
}

function renderProfile(records) {
  document.querySelector('#profile-total').textContent = String(records.length);
  document.querySelector('#profile-tags').textContent = String(new Set(records.flatMap((record) => record.tags)).size);
}

async function renderCurrentPage() {
  const records = (await getAllRecords()).sort((a, b) => b.eaten_at.localeCompare(a.eaten_at));
  switch (document.body.dataset.page) {
    case 'home': return renderHome(records);
    case 'calendar_page': return renderCalendar(records);
    case 'statistics': return renderStatistics(records);
    case 'profile': return renderProfile(records);
    default: return undefined;
  }
}

function localDateTimeValue(date) {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 16);
}

function setFormRecord(record) {
  document.querySelector('#food-name').value = record.food_name;
  document.querySelector('#meal-type').value = record.meal_type;
  document.querySelector('#cuisine-type').value = record.cuisine_type;
  document.querySelector('#eaten-at').value = localDateTimeValue(new Date(record.eaten_at));
  document.querySelector('#tags').value = record.tags.join(', ');
  document.querySelector('#note').value = record.note || '';
  if (record.image) {
    const preview = document.querySelector('#image-preview');
    preview.src = URL.createObjectURL(record.image);
    preview.hidden = false;
    preview.closest('.upload-box').classList.add('has-image');
    document.querySelector('#remove-image-row').hidden = false;
  }
}

async function initializeRecordForm(records) {
  const panel = document.querySelector('#record-form');
  const isEditing = panel.dataset.editing === 'true';
  const recordId = panel.dataset.recordId;
  const existing = isEditing ? await getRecord(recordId) : null;
  if (isEditing && !existing) {
    const error = document.querySelector('#form-error');
    error.textContent = '找不到這筆本機紀錄，可能已被刪除。';
    error.hidden = false;
    document.querySelector('#save-record').disabled = true;
    return;
  }
  if (existing) setFormRecord(existing);
  else document.querySelector('#eaten-at').value = localDateTimeValue(new Date());

  const knownTags = new Set(records.flatMap((record) => record.tags));
  const suggestions = document.querySelector('#tag-suggestions');
  suggestions.replaceChildren(...[...knownTags].sort().map((tag) => {
    const option = document.createElement('option');
    option.value = tag;
    return option;
  }));

  const imageInput = document.querySelector('#image-input');
  imageInput.addEventListener('change', () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 6 * 1024 * 1024) {
      imageInput.value = '';
      showMessage('請選擇圖片檔案，且大小需小於 6 MB。');
      return;
    }
    const preview = document.querySelector('#image-preview');
    preview.src = URL.createObjectURL(file);
    preview.hidden = false;
    preview.closest('.upload-box').classList.add('has-image');
    document.querySelector('#remove-image-row').hidden = true;
  });

  document.querySelector('#remove-image').addEventListener('change', (event) => {
    if (!event.target.checked) return;
    const preview = document.querySelector('#image-preview');
    preview.hidden = true;
    preview.closest('.upload-box').classList.remove('has-image');
  });

  document.querySelector('#save-record').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const name = document.querySelector('#food-name').value.trim();
    const meal = document.querySelector('#meal-type').value;
    const cuisine = document.querySelector('#cuisine-type').value;
    const eatenValue = document.querySelector('#eaten-at').value;
    const error = document.querySelector('#form-error');
    if (!name || !meal || !cuisine || !eatenValue) {
      error.textContent = '請填寫食物名稱、餐別、料理類型與時間。';
      error.hidden = false;
      return;
    }
    error.hidden = true;
    button.disabled = true;
    button.textContent = '正在儲存到本機…';
    const tags = [...new Set(document.querySelector('#tags').value.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean).map((tag) => tag.slice(0, 40)))];
    const selectedImage = imageInput.files?.[0];
    const record = {
      id: existing?.id ?? Date.now(),
      food_name: name,
      eaten_at: new Date(eatenValue).toISOString(),
      date_key: eatenValue.slice(0, 10),
      meal_type: meal,
      cuisine_type: cuisine,
      image: selectedImage || (document.querySelector('#remove-image').checked ? null : existing?.image || null),
      tags,
      note: document.querySelector('#note').value.trim(),
      created_at: existing?.created_at || new Date().toISOString(),
    };
    try {
      await putRecord(record);
      window.location.assign('/');
    } catch {
      button.disabled = false;
      button.innerHTML = `${isEditing ? '儲存修改' : '完成紀錄'} <span>↗</span>`;
      error.textContent = '本機儲存失敗，請確認瀏覽器可用空間後再試。';
      error.hidden = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    const records = await getAllRecords();
    if (document.body.dataset.page === 'add_record' || document.body.dataset.page === 'edit_record') {
      await initializeRecordForm(records);
    } else {
      await renderCurrentPage();
    }
  } catch {
    showMessage('無法讀取瀏覽器本機資料。請確認使用一般瀏覽模式，並允許此網站儲存資料。');
  }
});
