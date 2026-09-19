// STEP 3 的「AI 安全三問」：把原本三個自我檢核勾選框換成三題選擇題。
//
// 關卡本身沒有改。畫面上看不到的 `.security-check` 三個 checkbox 還在，
// app.js 依舊讀它們決定能不能進申請書；這支檔案只做一件事——答對第 N 題就
// 幫第 N 個打勾、答錯就取消，然後派發 change 讓 app.js 走既有的
// syncFromDom() + saveDraft()。所以草稿存檔、「重新填寫」的清空、重新整理
// 後的狀態回推全部不用動，這一層也可以整個拿掉而流程照常。
(() => {
  const quiz = document.getElementById('securityQuiz');
  if (!quiz) return;

  const items = [...quiz.querySelectorAll('.quiz-item')];
  const gates = [...document.querySelectorAll('.security-check')];
  if (items.length !== gates.length) {
    // 題數和關卡數對不上就整個不啟用，不要留下半套狀態。
    console.warn('資安測驗題數與關卡數不符，維持原狀。', items.length, gates.length);
    return;
  }

  // 直接讀寫原生的 checked，繞過等一下要覆寫的那層 setter，避免遞迴。
  const nativeChecked = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked');
  let syncing = false;

  function render(item, gate) {
    const picked = item.querySelector('input[type="radio"]:checked');
    const feedback = item.querySelector('.quiz-feedback');
    const answer = item.dataset.answer;

    item.querySelectorAll('.quiz-option').forEach((option) => {
      const input = option.querySelector('input');
      const chosen = nativeChecked.get.call(input);
      option.classList.toggle('is-correct', chosen && input.value === answer);
      option.classList.toggle('is-wrong', chosen && input.value !== answer);
    });

    if (!picked) {
      item.classList.remove('answered', 'correct', 'wrong');
      feedback.textContent = '';
      return;
    }

    const correct = picked.value === answer;
    item.classList.add('answered');
    item.classList.toggle('correct', correct);
    item.classList.toggle('wrong', !correct);
    feedback.textContent = correct
      ? `答對了。${item.dataset.explain ?? ''}`
      : '再想想看，這題還沒答對。可以直接改選其他選項。';
  }

  items.forEach((item, index) => {
    const gate = gates[index];

    item.addEventListener('change', (event) => {
      if (event.target.type !== 'radio') return;
      const correct = event.target.value === item.dataset.answer;
      render(item, gate);
      if (nativeChecked.get.call(gate) === correct) return;
      syncing = true;
      nativeChecked.set.call(gate, correct);
      syncing = false;
      // app.js 掛在這個 change 上：重算 state.securityComplete 並存草稿。
      gate.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // 還原草稿與「重新填寫」是直接指派 `.checked`、不會發 change，
    // 所以攔在 setter 上才補得到這兩條路徑。草稿只存「這題有沒有答對」，
    // 答對過就把正解選回來，沒答對就清空。
    Object.defineProperty(gate, 'checked', {
      configurable: true,
      enumerable: true,
      get() { return nativeChecked.get.call(this); },
      set(next) {
        nativeChecked.set.call(this, next);
        if (syncing) return;
        const radios = [...item.querySelectorAll('input[type="radio"]')];
        radios.forEach((radio) => {
          nativeChecked.set.call(radio, Boolean(next) && radio.value === item.dataset.answer);
        });
        render(item, gate);
      },
    });

    render(item, gate);
  });
})();
