(() => {
  'use strict';

  /**
   * HideXForYou
   *
   * 目的:
   * - X.com のホームにある「おすすめ(For you) / フォロー中(Following)」タブのうち、
   *   「おすすめ」タブを非表示にする。
   *
   * 重要:
   * - X は SPA (Single Page Application) なので、画面遷移や戻る操作で DOM が作り直される。
   * - そのため「一度だけ隠して終了」ではなく、軽量に“再適用”し続ける必要がある。
   */

  const LOG = '[HideXForYou]';

  // Home のタブリスト（「おすすめ」「フォロー中」）
  const TABLIST_SELECTOR = 'div[role="tablist"][data-testid="ScrollSnap-List"]';
  const TAB_SELECTOR = 'div[role="tab"]';
  const PRESENTATION_SELECTOR = 'div[role="presentation"]';

  // デバッグ用フラグ（コンソールで document.documentElement.dataset.hideXForYou を確認できる）
  document.documentElement.dataset.hideXForYou = '1';

  /**
   * テキストを比較しやすい形に正規化する
   * - 改行/連続スペース等を除去して比較を安定させる
   */
  function normalizeText(s) {
    return (s ?? '').replace(/\s+/g, '').trim();
  }

  /**
   * 可能な限り強く非表示にする。
   * - X 側が style を上書きしてくるケースに備え、important を付与する
   */
  function forceHide(el) {
    el.style.setProperty('display', 'none', 'important');
    el.style.setProperty('pointer-events', 'none', 'important');
  }

  /**
   * 指定タブをラップしている要素（role=presentation）ごと隠す。
   * ラッパが取れない場合はタブ自体を隠す。
   */
  function getHideTarget(tabEl) {
    return tabEl.closest(PRESENTATION_SELECTOR) ?? tabEl;
  }

  /**
   * タブリストから「おすすめ」「フォロー中」タブを探して返す。
   */
  function findTabs(tablistEl) {
    const tabs = Array.from(tablistEl.querySelectorAll(TAB_SELECTOR));
    const texts = tabs.map(t => normalizeText(t.textContent));

    // 言語が英語でも動くように、テキストで判定する
    const forYou = tabs.find(t => {
      const raw = t.textContent ?? '';
      const n = normalizeText(raw);
      return n.includes('おすすめ') || /for\s*you/i.test(raw);
    });

    const following = tabs.find(t => {
      const raw = t.textContent ?? '';
      const n = normalizeText(raw);
      return n.includes('フォロー中') || /following/i.test(raw);
    });

    return { tabs, texts, forYou, following };
  }

  /**
   * 1回分の適用。
   * - 条件が揃っていれば「おすすめ」タブを隠す
   * - 「おすすめ」が選択中(aria-selected=true)なら「フォロー中」に寄せる
   */
  function applyOnce() {
    const tablist = document.querySelector(TABLIST_SELECTOR);
    if (!tablist) return;

    const { tabs, texts, forYou, following } = findTabs(tablist);
    if (tabs.length < 2) return;

    // Home のタブリスト以外に誤爆しないための安全弁
    // （「おすすめ」と「フォロー中」が同時に存在するケースだけ対象にする）
    if (!forYou || !following) return;

    const target = getHideTarget(forYou);

    // DOM が作り直されると target も新規ノードになる。
    // ノード単位で「すでに隠したか」を記録する。
    if (target.dataset.__hxfyHidden === '1') return;

    // 「おすすめ」タブが選択中だと、隠した瞬間に UI が不自然になる。
    // 先に「フォロー中」へ切り替える（連打ループ防止のガード付き）。
    const isForYouSelected = forYou.getAttribute('aria-selected') === 'true';
    if (isForYouSelected) {
      if (tablist.dataset.__hxfySwitched !== '1') {
        tablist.dataset.__hxfySwitched = '1';
        try { following.click(); } catch (_) {}
        // しばらくしてガード解除
        setTimeout(() => { tablist.dataset.__hxfySwitched = '0'; }, 1500);
      }
    }

    forceHide(target);
    target.dataset.__hxfyHidden = '1';

    // 必要なら確認用ログ（うるさい場合は削除/コメントアウトでOK）
    // console.log(LOG, 'hidden OK', { texts });
  }

  /**
   * DOM 変更が多いので、MutationObserver のコールバックから直接 applyOnce() を叩かず、
   * requestAnimationFrame で1フレームに1回へ間引く。
   */
  let scheduled = false;
  function scheduleApply() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try {
        applyOnce();
      } catch (e) {
        console.warn(LOG, 'apply error', e);
      }
    });
  }

  /**
   * SPA の URL 変更（pushState/replaceState/popstate）も拾って再適用する。
   * - 画面遷移直後は DOM がまだ揃わないことがあるので scheduleApply に寄せる。
   */
  function hookHistory() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;

    history.pushState = function (...args) {
      const ret = origPush.apply(this, args);
      scheduleApply();
      return ret;
    };

    history.replaceState = function (...args) {
      const ret = origReplace.apply(this, args);
      scheduleApply();
      return ret;
    };

    window.addEventListener('popstate', scheduleApply, { passive: true });
  }

  // 実行開始
  console.log(LOG, 'content script injected', location.href);
  hookHistory();
  scheduleApply();

  // DOM の作り直しに追随
  const observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // タブを閉じて復帰した時などの保険
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleApply();
  });
})();
