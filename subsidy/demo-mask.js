// 展示用遮蔽層：身分證、電話、金融帳號在畫面上即時變成 * 字號，只留末三碼。
//
// 刻意不去動 input.value —— 檢查碼驗證、草稿儲存、送出的 payload 都還是讀原值，
// 所以這支檔案可以獨立掛上或拿掉，不會影響 app.js 的任何流程。
// 作法是把真正的文字染成透明，另外疊一層同字距的遮蔽字串在上面。
(() => {
  const FIELD_IDS = ['idInput', 'phoneInput', 'bankCode', 'bankAccount'];
  const KEEP = 3; // 末三碼保持可見，方便 demo 時口頭核對。

  // 直接讀寫原生的 value，繞過等一下要覆寫的那層 getter/setter，避免遞迴。
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

  function maskOf(value) {
    const chars = Array.from(value);
    if (chars.length === 0) return '';
    // 長度不到 KEEP 的時候整串遮掉，不然一開始打的前幾個字反而會全部露出來。
    if (chars.length <= KEEP) return '*'.repeat(chars.length);
    return '*'.repeat(chars.length - KEEP) + chars.slice(-KEEP).join('');
  }

  function attach(input) {
    const wrap = document.createElement('div');
    wrap.className = 'mask-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    // 刻意用 div 不用 span：`.field span` 會把字體改成 13px/700，
    // 遮蔽字串就會和 input 裡的文字對不齊，游標位置跟著跑掉。
    const overlay = document.createElement('div');
    overlay.className = 'mask-overlay';
    // 螢幕報讀軟體唸原本的 input 就好，遮蔽層只是視覺效果。
    overlay.setAttribute('aria-hidden', 'true');
    wrap.appendChild(overlay);

    function render() {
      const raw = nativeValue.get.call(input) ?? '';
      overlay.textContent = maskOf(raw);
      // 空值時不要染透明，否則 placeholder 也會跟著看不見。
      wrap.classList.toggle('is-masked', raw.length > 0);
      overlay.scrollLeft = input.scrollLeft;
    }

    ['input', 'change', 'focus', 'blur', 'scroll'].forEach((type) => {
      input.addEventListener(type, render);
    });

    // 還原草稿與「重新填寫」是直接指派 input.value，不會發 input 事件，
    // 所以攔在 setter 上才補得到這兩條路徑。
    Object.defineProperty(input, 'value', {
      configurable: true,
      enumerable: true,
      get() { return nativeValue.get.call(this); },
      set(next) {
        nativeValue.set.call(this, next);
        render();
      },
    });

    render();
  }

  function init() {
    FIELD_IDS.forEach((id) => {
      const input = document.getElementById(id);
      if (input && !input.closest('.mask-wrap')) attach(input);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
