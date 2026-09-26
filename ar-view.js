// ============================================================
// 売掛ウォッチ（未入金売掛アプリ）: 画面の計算だけの関数
// 計画 §3-5・§3-8・G10。DOM にも通信にも触れない。
// ブラウザでは window.ArView、node の試験（tests/ar-app/view.test.js）では require で読む。
// ============================================================
(function (root) {
  'use strict';

  // レーンと詳細のボタンの並び。ノータッチ → 連絡済み（こちらから連絡した）→ 連絡あり（相手から連絡が来た）（2026-09-26 ユーザー指示）
  var STATUSES = ['ノータッチ', '連絡済み', '連絡あり'];

  // 検索のための正規化（全角・半角と大文字・小文字の違いを無くす）
  function norm(s) {
    return String(s === null || s === undefined ? '' : s).normalize('NFKC').toLowerCase();
  }

  // 検索: 取引先名・件名・請求番号・メモの本文（全文）。空白で区切った語をすべて含むものだけ残す（G10）
  function matchesQuery(card, query) {
    var terms = norm(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    var hay = [card.partner, card.title, card.billingNumber, card.memo].map(norm).join('\n');
    return terms.every(function (t) { return hay.indexOf(t) >= 0; });
  }

  // 経過日数の絞り込み。0 は「すべて」＝期日前（日数が負）と日数不明（期日が空）も出す。
  // 1 は「期日を過ぎたもの」＝期日の翌日以降（期日当日の 0 は入れない）。既定（2026-09-26 ユーザー指示。サーバの bootstrap が返す）。
  // G3 は日数0で MF請求の未入金・未設定の全件と突き合わせるので、0 で何かを隠すと一致しなくなる
  function passesDays(card, minDays) {
    if (!(minDays > 0)) return true;
    var d = card.days === null || card.days === undefined ? null : card.days;
    return d !== null && d >= minDays;
  }

  function filterCards(cards, opt) {
    return (cards || []).filter(function (c) { return passesDays(c, opt.days) && matchesQuery(c, opt.query); });
  }

  // 並び順: 経過日数の多い順（日数不明は最後）／請求額の多い順／取引先名順。同じなら請求番号順
  function sortCards(cards, sort) {
    var byNumber = function (a, b) { return String(a.billingNumber).localeCompare(String(b.billingNumber), 'ja', { numeric: true }); };
    var cmp;
    if (sort === 'amount') cmp = function (a, b) { return (b.amount || 0) - (a.amount || 0); };
    else if (sort === 'client') cmp = function (a, b) { return String(a.partner).localeCompare(String(b.partner), 'ja'); };
    else cmp = function (a, b) {
      var da = a.days === null || a.days === undefined ? -Infinity : a.days;
      var db = b.days === null || b.days === undefined ? -Infinity : b.days;
      return da === db ? 0 : (db > da ? 1 : -1);
    };
    return (cards || []).slice().sort(function (a, b) { return cmp(a, b) || byNumber(a, b); });
  }

  // カードに出すメモの抜粋: 先頭2行（3行目以降は出さない）。見た目の2行での切り詰めは CSS が行う
  function memoExcerpt(memo) {
    var lines = String(memo || '').split(/\r?\n/);
    return lines.slice(0, 2).join('\n').slice(0, 200);
  }

  function ageClass(days) {
    if (days === null || days === undefined) return '';
    return days >= 60 ? 'high' : days >= 30 ? 'medium' : '';
  }

  function ageLabel(tab, days) {
    if (days === null || days === undefined) return tab === '未入金' ? '期日なし' : '作成日なし';
    if (tab === '未入金') return days >= 0 ? days + '日超過' : '期日まで' + (-days) + '日';
    return '作成から' + days + '日';
  }

  function yen(n) {
    return '¥' + Number(n || 0).toLocaleString('ja-JP');
  }

  function jpDate(ymd) {
    return ymd ? String(ymd).replace(/-/g, '/') : '—';
  }

  // 集計カード3枚（表示中の件数・表示分の請求額・未連絡の件数）
  function summarize(cards) {
    var total = 0;
    var untouched = 0;
    (cards || []).forEach(function (c) { total += c.amount || 0; if (c.status === 'ノータッチ') untouched++; });
    return { count: (cards || []).length, total: total, untouched: untouched };
  }

  // 詳細の記録（新しい順の records）から、1行ずつの文言を作る（計画 §3-4-2）。
  // 連絡状況の変化の「前」は、1つ古い記録の連絡状況（無ければ ノータッチ）
  function historyLines(records) {
    return (records || []).map(function (r, i) {
      var older = records[i + 1];
      var prev = older ? older.status : 'ノータッチ';
      var parts = [];
      if (r.statusChanged) parts.push('連絡状況: ' + prev + ' → ' + r.status);
      if (r.memoChanged) parts.push(r.memo === '' ? 'メモを消去' : 'メモを更新');
      if (!parts.length) parts.push('（変更なし）');
      return { recordId: r.recordId, when: shortAt(r.at), who: r.email || '', content: parts.join('／') };
    });
  }

  // 'yyyy/MM/dd HH:mm:ss' → 'yyyy/MM/dd HH:mm'
  function shortAt(at) {
    var s = String(at || '');
    return /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.slice(0, 16) : s;
  }

  // 応答の種類を決める（W1 で分かったこと1・2）。
  //   ok      … JSON で ok=true
  //   fail    … JSON で ok=false（code に種別）
  //   broken  … JSON として読めない・形が違う（書けたかどうか分からない）
  //   timeout … 待ち時間の上限で打ち切った（書けたかどうか分からない）
  //   network … 通信そのものが失敗した
  function classifyResponse(r) {
    if (!r) return { kind: 'network' };
    if (r.aborted) return { kind: 'timeout' };
    if (r.networkError) return { kind: 'network' };
    var j;
    try { j = JSON.parse(r.text); } catch (e) { return { kind: 'broken' }; }
    if (!j || typeof j !== 'object' || typeof j.ok !== 'boolean') return { kind: 'broken' };
    return j.ok ? { kind: 'ok', json: j } : { kind: 'fail', json: j, code: String(j.code || '') };
  }

  // 保存・移動の失敗を、利用者に見せる文言にする
  function failureText(kind, code) {
    if (kind === 'timeout') return '応答がありませんでした（15秒）';
    if (kind === 'broken') return '応答を読めませんでした';
    if (kind === 'network') return '通信できませんでした';
    var m = {
      CONFLICT: 'ほかの人が先に更新しました',
      PAID_OR_OUT_OF_SCOPE: 'この請求は入金済みになりました',
      NOT_FOUND: 'この請求は見つかりませんでした',
      MF_ERROR: 'マネーフォワードから読めませんでした',
      BAD_REQUEST: '送った内容に誤りがありました',
      SERVER_ERROR: 'サーバで問題が起きました',
      CANCELLED: 'この操作は取り消されていました',
      UNAUTHENTICATED: 'サインインの期限が切れました',
      FORBIDDEN: '利用が許可されていません'
    };
    return m[code] || ('保存できませんでした（' + code + '）');
  }

  // 保存で送る変更（変わった項目だけ）。何も変わらなければ null
  function buildUpdate(card, draftStatus, draftMemo) {
    var out = { billingId: card.billingId, baseRecordId: card.lastRecordId || 0 };
    var changed = false;
    if (draftStatus !== null && draftStatus !== undefined && draftStatus !== card.status) { out.status = draftStatus; changed = true; }
    if (draftMemo !== null && draftMemo !== undefined && draftMemo !== card.memo) { out.memo = draftMemo; changed = true; }
    return changed ? out : null;
  }

  // ---- 保存されなかったメモの控え（W5 第3巡 指摘2・第4巡 指摘2・差分確認 第1巡 指摘1） ----
  // lost は 請求ID → { partner, items: [{ text, memo }] }。請求ごとに複数件を持つ（続けて失敗しても先の控えを上書きしない）。
  // 控えが消えるのは、利用者が1件ずつ「消す」ときと、同じ内容の保存が成功したとき（その内容の控えだけ）

  // 控えを足す。空のメモは足さない（残すものが無い）。同じ請求に同じ内容の控えが既にあれば足さない
  // Google の ID トークン（JWT）の本文から sub を読む。署名は確かめない（確かめるのはサーバ）。
  // 画面の中で「控えの持ち主」を見分けるためだけに使う。読めなければ null（W6 後の確認 第1巡 指摘3）
  function tokenSub(token) {
    try {
      var part = String(token || '').split('.')[1];
      if (!part) return null;
      var b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var sub = JSON.parse(atob(b64)).sub;
      return typeof sub === 'string' && sub ? sub : null;
    } catch (e) {
      return null;
    }
  }

  function addLost(lost, id, partner, text, memo) {
    if (memo === null || memo === undefined || memo === '') return lost;
    var e = lost[id] || (lost[id] = { partner: partner || '', items: [] });
    if (!e.items.some(function (x) { return x.memo === memo; })) e.items.push({ text: text || '', memo: memo });
    return lost;
  }

  // メモを持たない控え（連絡状況だけ・メモを消すだけの、保存されなかった変更）。説明だけを残し、同じ説明は足さない。
  // 保存が成功しても自動では外さない（「消す」で外す）（W6 後の確認 第2巡 指摘1）
  function addIntent(lost, id, partner, text) {
    if (!text) return lost;
    var e = lost[id] || (lost[id] = { partner: partner || '', items: [] });
    if (!e.items.some(function (x) { return x.memo === null && x.text === text; })) e.items.push({ text: text, memo: null });
    return lost;
  }

  // 拒否・サインイン切れで詳細を閉じるときの、書きかけの控え方。
  // メモを書き換えていればメモの控え（連絡状況も変えていれば説明に書く）。メモが無い変更は説明だけの控え
  function stashDraft(lost, id, partner, card, draftStatus, draftMemo) {
    var ds = draftStatus !== null && draftStatus !== undefined && draftStatus !== card.status ? draftStatus : null;
    var dm = draftMemo !== null && draftMemo !== undefined && draftMemo !== card.memo ? draftMemo : null;
    var why = 'サインインが切れた・許可されなかったため保存していません';
    if (dm) return addLost(lost, id, partner, why + (ds ? '。連絡状況「' + ds + '」も保存していません' : ''), dm);
    var parts = [];
    if (ds) parts.push('連絡状況を「' + ds + '」にする');
    if (dm === '') parts.push('メモを消す');
    if (!parts.length) return lost;
    return addIntent(lost, id, partner, why + '（' + parts.join('・') + '）。サインインし直してから、もう一度操作してください');
  }

  // 保存できた内容と同じ控えだけを外す
  function removeLostMemo(lost, id, memo) {
    var e = lost[id];
    if (!e) return lost;
    e.items = e.items.filter(function (x) { return x.memo !== memo; });
    if (!e.items.length) delete lost[id];
    return lost;
  }

  // 利用者が「消す」を押した1件を外す
  function dismissLost(lost, id, idx) {
    var e = lost[id];
    if (!e || !(idx >= 0 && idx < e.items.length)) return lost;
    e.items.splice(idx, 1);
    if (!e.items.length) delete lost[id];
    return lost;
  }

  // 「要確認」欄の項目。確定できていない操作を先に、保存されなかったメモの控えを後に（1件ずつ）並べる。
  // 一覧に請求があるかどうかに関係なく出す（入金済みで一覧から消えても、確かめ直し・メモの取り出しができる）
  function attentionItems(unsettled, lost) {
    var out = [];
    Object.keys(unsettled || {}).forEach(function (id) {
      var u = unsettled[id];
      out.push({ id: id, kind: 'unsettled', partner: u.partner || '', memo: u.lostMemo === undefined ? null : u.lostMemo,
        text: (u.kind === 'drag' ? '移動' : '保存') + 'できたかを、まだ確かめられていません' });
    });
    Object.keys(lost || {}).forEach(function (id) {
      var l = lost[id];
      (l.items || []).forEach(function (it, idx) {
        out.push({ id: id, idx: idx, kind: 'lost', partner: l.partner || '', memo: it.memo, text: it.text || '' });
      });
    });
    return out;
  }

  var api = {
    STATUSES: STATUSES, norm: norm, matchesQuery: matchesQuery, passesDays: passesDays, filterCards: filterCards,
    sortCards: sortCards, memoExcerpt: memoExcerpt, ageClass: ageClass, ageLabel: ageLabel, yen: yen, jpDate: jpDate,
    summarize: summarize, historyLines: historyLines, shortAt: shortAt, classifyResponse: classifyResponse,
    failureText: failureText, buildUpdate: buildUpdate, attentionItems: attentionItems, tokenSub: tokenSub, addIntent: addIntent, stashDraft: stashDraft,
    addLost: addLost, removeLostMemo: removeLostMemo, dismissLost: dismissLost
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArView = api;
})(this);
