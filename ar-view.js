// ============================================================
// 売掛ウォッチ（未入金売掛アプリ）: 画面の計算だけの関数
// 計画 §3-5・§3-8・G10。DOM にも通信にも触れない。
// ブラウザでは window.ArView、node の試験（tests/ar-app/view.test.js）では require で読む。
// ============================================================
(function (root) {
  'use strict';

  // レーンと詳細のボタンの並び。未納品 → ノータッチ → 連絡済み（こちらから連絡した）→ 連絡あり（相手から連絡が来た）
  // （2026-09-26 ユーザー指示。未納品は 2026-09-28 ユーザー依頼 ar-app-assignee §6-13。記録の無い請求の置き場はノータッチのまま）
  var STATUSES = ['未納品', 'ノータッチ', '連絡済み', '連絡あり'];

  // カードを置くレーン。この画面が知らない連絡状況（後の版で足した値など）はノータッチのレーンに出し、一覧から消さない
  // （§6-13 レビュー第1巡 major 1 の処置。ユーザー判断 2026-09-28「安全な戻し先を用意」）。札には元の値をそのまま出す
  function laneOf(status) {
    return STATUSES.indexOf(status) >= 0 ? status : 'ノータッチ';
  }

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
    return (cards || []).filter(function (c) {
      return passesDays(c, opt.days) && matchesQuery(c, opt.query) && passesStaff(c, opt.staff, opt.staffList);
    });
  }

  // ---- 取引先ごとの担当者（計画 ar-app-assignee §2-2・§3-4） ----
  var ALL_STAFF = '全社';
  var UNASSIGNED = '__unassigned__';   // 「未割り当て」の絞り込みの値（メールと重ならない）

  function findStaff(staff, email) {
    return (staff || []).filter(function (x) { return x.email === email; })[0] || null;
  }

  // 担当者の表示名。無効の営業は「（無効）」を付ける。利用者シートから消えた人も分かるように出す
  function assigneeLabel(staff, email) {
    if (!email) return '未割り当て';
    var x = findStaff(staff, email);
    if (!x) return '（利用者シートに無い人）';
    return x.active ? x.name : x.name + '（無効）';
  }

  // 「未割り当て」の絞り込みに入るか: 担当が空・無効の営業・シートから消えた人（付け替え漏れに気づけるように。§1-2）
  function isUnassigned(staff, email) {
    var x = email ? findStaff(staff, email) : null;
    return !x || !x.active;
  }

  function passesStaff(card, sel, staff) {
    if (!sel || sel === ALL_STAFF) return true;
    if (sel === UNASSIGNED) return isUnassigned(staff, card.assignee);
    return card.assignee === sel;
  }

  // 右上の「担当」の選択肢: 全社／有効な営業／未割り当て
  function staffChoices(staff) {
    return [{ value: ALL_STAFF, label: '全社' }]
      .concat((staff || []).filter(function (x) { return x.active; }).map(function (x) { return { value: x.email, label: x.name }; }))
      .concat([{ value: UNASSIGNED, label: '未割り当て' }]);
  }

  // 「担当」の既定: 営業（有効）は自分、それ以外は全社（§1-2）
  function defaultStaff(user, staff) {
    var email = user && user.email ? String(user.email).toLowerCase() : '';
    var x = email ? findStaff(staff, email) : null;
    return user && user.role === '営業' && x && x.active ? email : ALL_STAFF;
  }

  // 保存の応答で、担当が保存されたかを確かめる。担当を送っていなければ真。
  // 旧サーバの応答には state.assignee が無い（担当を黙って捨てる）ので偽（計画レビュー第1巡 指摘2）。
  // 欄があるだけでは真にしない。送った担当と同じ値のときだけ真（H1 実装レビュー第2巡 指摘1）
  function assigneeSaved(body, state) {
    if (!body || body.assignee === undefined) return true;
    return !!state && typeof state.assignee === 'string' && state.assignee === body.assignee;
  }

  // 「変更をまとめて保存」の後に詳細を閉じてよいか（ユーザー依頼 2026-09-26）。行を書いて保存でき、担当も送ったとおりに
  // 保存できたときだけ閉じる。変更なし・担当が保存されなかったときは、知らせと控えを見せるため開いたままにする
  function closeAfterSave(body, json) {
    return !!(json && json.state && !json.unchanged && assigneeSaved(body, json.state));
  }

  // 確定（settleOpId）の応答で、担当が保存できていたかを操作ごとの証拠（settledOp）で判断する（H1 実装レビュー第2巡 指摘1）。
  //   'saved'   … その操作の行で、送った担当に変えていた
  //   'notSaved'… その操作の行は担当を変えていない（旧サーバが書いた・別の値）
  //   'unknown' … 証拠が無い（旧サーバの確定の応答）。成功とは扱わない
  // 今の担当（state.assignee）は、別の操作や版の切り替えで入りうるので証拠に使わない
  function settledAssignee(want, json) {
    var op = json && json.settledOp;
    if (!op || typeof op !== 'object') return 'unknown';
    return op.assigneeChanged === true && op.assignee === want ? 'saved' : 'notSaved';
  }

  // 同じ取引先ID のカードすべての担当を合わせる。担当の記録ID が今より古い応答では戻さない（K2 と同じ考え方）。合わせた数を返す
  function applyAssignee(cards, partnerId, assignee, recordId) {
    if (!partnerId || typeof assignee !== 'string' || typeof recordId !== 'number') return 0;
    var n = 0;
    (cards || []).forEach(function (c) {
      if (c.partnerId !== partnerId || recordId < (c.assigneeRecordId || 0)) return;
      c.assignee = assignee; c.assigneeRecordId = recordId; n++;
    });
    return n;
  }

  // 担当の履歴（新しい順の assigneeHistory）から1行ずつの文言を作る。別の請求で変えたものには請求番号を添える（§2-2 の6）
  function assigneeLines(history, staff) {
    return (history || []).map(function (h) {
      return { recordId: h.recordId, when: shortAt(h.at), who: h.email || '',
        content: '担当: ' + assigneeLabel(staff, h.from) + ' → ' + assigneeLabel(staff, h.to) +
          (h.sameBilling ? '' : '（請求 No.' + h.billingNumber + ' で変更）') };
    });
  }

  // 詳細の記録の欄: 連絡状況・メモ（records からだけ求める）と担当（assigneeHistory からだけ求める）を記録ID の新しい順に並べる。
  // 同じ記録ID（この請求で担当と一緒に変えた行）は1行にまとめる。担当だけの行の「（変更なし）」は担当の文言に置き換える（第1巡 指摘1）
  function detailLines(records, history, staff) {
    var byId = {};
    var order = [];
    historyLines(records).forEach(function (l) { byId[l.recordId] = l; order.push(l.recordId); });
    assigneeLines(history, staff).forEach(function (a) {
      var l = byId[a.recordId];
      if (!l) { byId[a.recordId] = a; order.push(a.recordId); return; }
      l.content = l.content === '（変更なし）' ? a.content : l.content + '／' + a.content;
    });
    return order.sort(function (x, y) { return y - x; }).map(function (id) { return byId[id]; });
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

  // カードに出すメモの抜粋: 先頭3行（4行目以降は出さない。2026-09-28 ユーザー依頼で2行から3行へ。§6-13）。見た目の3行での切り詰めは CSS が行う
  function memoExcerpt(memo) {
    var lines = String(memo || '').split(/\r?\n/);
    return lines.slice(0, 3).join('\n').slice(0, 300);
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
      PARTNER_UNKNOWN: 'この請求の取引先を特定できませんでした',
      PARTNER_CHANGED: 'この請求の取引先が変わっていました（一覧を取り直してください）',
      UNAUTHENTICATED: 'サインインの期限が切れました',
      FORBIDDEN: '利用が許可されていません'
    };
    return m[code] || ('保存できませんでした（' + code + '）');
  }

  // 保存で送る変更（変わった項目だけ）。何も変わらなければ null。
  // 担当は、取引先ID のあるカードで今と違うときだけ送り、画面が見ていた担当の記録ID と取引先ID を添える（ar-app-assignee §3-2）
  function buildUpdate(card, draftStatus, draftMemo, draftAssignee) {
    var out = { billingId: card.billingId, baseRecordId: card.lastRecordId || 0 };
    var changed = false;
    if (draftStatus !== null && draftStatus !== undefined && draftStatus !== card.status) { out.status = draftStatus; changed = true; }
    if (draftMemo !== null && draftMemo !== undefined && draftMemo !== card.memo) { out.memo = draftMemo; changed = true; }
    if (draftAssignee !== null && draftAssignee !== undefined && card.partnerId && draftAssignee !== (card.assignee || '')) {
      out.assignee = draftAssignee; out.baseAssigneeRecordId = card.assigneeRecordId || 0; out.partnerId = card.partnerId; changed = true;
    }
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

  // ---- 段C（案B+）: 操作の希望の全項目（計画 ar-app-perf §8-13-1 の1・§8-14-1 の P1） ----
  // 希望 = 変えようとした項目だけを持つ { status?, memo?（空にする変更を含む）, assignee? }

  // 保存・移動で送る変更（buildUpdate の形）から、希望を写す
  function wishOf(body) {
    var w = {};
    if (!body) return w;
    if (body.status !== undefined) w.status = body.status;
    if (body.memo !== undefined) w.memo = body.memo;
    if (body.assignee !== undefined) w.assignee = body.assignee;
    return w;
  }

  // 詳細の書きかけ（今のカードと違う項目だけ）を希望にする。一覧から消えた・サインインが切れたときの回収に使う
  function draftWish(card, draftStatus, draftMemo, draftAssignee) {
    var w = {};
    if (!card) return w;
    if (draftStatus !== null && draftStatus !== undefined && draftStatus !== card.status) w.status = draftStatus;
    if (draftMemo !== null && draftMemo !== undefined && draftMemo !== card.memo) w.memo = draftMemo;
    if (draftAssignee !== null && draftAssignee !== undefined && draftAssignee !== (card.assignee || '')) w.assignee = draftAssignee;
    return w;
  }

  function wishEmpty(w) { return !w || (w.status === undefined && w.memo === undefined && w.assignee === undefined); }

  // 希望を項目ごとの文言にする（要確認に出す）
  function wishLines(w, staff) {
    var out = [];
    if (!w) return out;
    if (w.status !== undefined) out.push('連絡状況 → ' + w.status);
    if (w.memo !== undefined) out.push(w.memo === '' ? 'メモ → （空にする）' : 'メモ → 書き換え（下の「書いたメモを見る」）');
    if (w.assignee !== undefined) out.push('担当 → ' + assigneeLabel(staff, w.assignee));
    return out;
  }

  // 書かれなかったと決まった操作の希望を、要確認の1件として残す（全項目）。
  // meta.key は回収の識別子: 操作なら操作ID、送っていない書きかけなら 'draft:' で始まる使い捨ての ID（段C C2 R3）。
  // 同じ識別子・同じ理由の控えがあれば足さない（同じ操作の二重登録を防ぐ。§8-14-2 の I2）。識別子が違えば、内容が同じでも別の1件。
  // 識別子が無い呼び方（古い形）は、同じ理由・同じ希望で重ねない。meta.billingNumber は要確認に出す請求番号
  function addWish(lost, id, partner, text, w, meta) {
    if (wishEmpty(w)) return lost;
    meta = meta || {};
    var copy = {};
    ['status', 'memo', 'assignee'].forEach(function (k) { if (w[k] !== undefined) copy[k] = w[k]; });
    var e = lost[id] || (lost[id] = { partner: partner || '', items: [] });
    var t = text || '';
    var dup = meta.key
      ? e.items.some(function (x) { return x.key === meta.key && x.text === t; })
      : e.items.some(function (x) { return x.wish && !x.key && x.text === t && JSON.stringify(x.wish) === JSON.stringify(copy); });
    if (!dup) {
      e.items.push({ text: t, memo: typeof copy.memo === 'string' ? copy.memo : null, wish: copy,
        key: meta.key || null, billingNumber: meta.billingNumber || '' });
    }
    return lost;
  }

  // 担当を変える書き込みが、同じ取引先で送信中・未確定のまま残っているか（§8-11-2 の3・§8-13-2 の1）
  function partnerAssigneeLocked(write, unsettled, partnerId) {
    if (!partnerId) return false;
    if (write && write.partnerId === partnerId && write.wish && write.wish.assignee !== undefined) return true;
    return Object.keys(unsettled || {}).some(function (k) {
      var u = unsettled[k];
      return u && u.partnerId === partnerId && u.assignee !== undefined;
    });
  }

  // 書き込みの要求の fetch の指定（§8-11-2 の8・§8-14-2 の I3）。keepalive はページを閉じても送り切る指定。
  // 本文の上限（64 KiB、MDN の RequestInit）を超えないよう、送る本文（符号化の後）が 60,000 バイトを超えたら付けない
  var KEEPALIVE_MAX_BYTES = 60000;
  function fetchInit(payload, keepalive) {
    var body = new URLSearchParams({ payload: JSON.stringify(payload) });
    var bytes = body.toString().length;   // URLSearchParams の文字列は ASCII だけ（1文字＝1バイト）
    var init = { method: 'POST', body: body };
    if (keepalive && bytes <= KEEPALIVE_MAX_BYTES) init.keepalive = true;
    return { init: init, bytes: bytes };
  }

  // 保存できた内容と同じ控えだけを外す（メモだけの古い控えに限る。希望の全項目の控えは、本人が「消す」まで残す）
  function removeLostMemo(lost, id, memo) {
    var e = lost[id];
    if (!e) return lost;
    e.items = e.items.filter(function (x) { return x.wish || x.memo !== memo; });
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
      out.push({ id: id, kind: 'unsettled', partner: u.partner || '', billingNumber: u.billingNumber || '', key: u.opId || null, memo: u.lostMemo === undefined ? null : u.lostMemo, wish: u.wish || null,
        text: (u.kind === 'drag' ? '移動' : '保存') + 'できたかを、まだ確かめられていません' });
    });
    Object.keys(lost || {}).forEach(function (id) {
      var l = lost[id];
      (l.items || []).forEach(function (it, idx) {
        out.push({ id: id, idx: idx, kind: 'lost', partner: l.partner || '', billingNumber: it.billingNumber || '', key: it.key || null, memo: it.memo, wish: it.wish || null, text: it.text || '' });
      });
    });
    return out;
  }


  // ---- 計画 ar-app-perf（速度改善）K2: 詳細の記録の併合 ----
  // 記録の集合を記録ID で重ねずに合わせ、新しい順に並べる。届いた順に関係なく同じ結果になる（計画 §3-2）
  function mergeRecords(a, b) {
    var byId = {};
    (a || []).concat(b || []).forEach(function (r) { if (r && typeof r.recordId === 'number') byId[r.recordId] = r; });
    return Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (x, y) { return y.recordId - x.recordId; });
  }

  // カードの状態を記録へ合わせるのは、記録ID が今より新しいときだけ（古い応答で戻さない）
  function newerState(card, st) {
    return !!card && !!st && typeof st.lastRecordId === 'number' && st.lastRecordId >= (card.lastRecordId || 0);
  }

  // ---- 計画 ar-app-perf §3-3（軽い計測 L） ----
  // 応答の種類を、計測の「結果」の値にする（サーバの許可値 AR_PERF_RESULTS と同じ）
  function perfResult(r) {
    if (!r) return 'network';
    if (r.kind === 'ok') return 'ok';
    if (r.kind === 'timeout' || r.kind === 'broken' || r.kind === 'network') return r.kind;
    var c = r.code;
    if (c === 'CONFLICT') return 'conflict';
    if (c === 'PAID_OR_OUT_OF_SCOPE' || c === 'NOT_FOUND') return 'paid';
    if (c === 'UNAUTHENTICATED' || c === 'FORBIDDEN') return 'auth';
    if (c === 'CANCELLED') return 'cancelled';
    return 'error';
  }

  // 応答の perf から、計測の行に写すサーバの時間（許可した欄だけ）
  var PERF_SERVER_FIELDS = ['tokenMs', 'tokenCached', 'usersMs', 'mfMs', 'recordsMs', 'mfGetOneMs'];
  function perfServerFields(json) {
    var out = {};
    if (!json) return out;
    if (typeof json.serverMs === 'number') out.serverMs = json.serverMs;
    var p = json.perf || {};
    PERF_SERVER_FIELDS.forEach(function (k) {
      if (k === 'tokenCached' ? typeof p[k] === 'boolean' : typeof p[k] === 'number') out[k] = p[k];
    });
    return out;
  }

  // 端末の待ち行列（持ち主ごと）。上限と期限を超えた古い行を捨て、捨てた数を返す
  var PERF_QUEUE_MAX = 200;
  var PERF_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  function perfQueueAdd(queue, rows, nowMs) {
    var q = (queue || []).concat(rows || []);
    var before = q.length;
    q = q.filter(function (r) { return typeof r.ts === 'number' && nowMs - r.ts <= PERF_QUEUE_AGE_MS; });
    if (q.length > PERF_QUEUE_MAX) q = q.slice(q.length - PERF_QUEUE_MAX);
    return { queue: q, dropped: before - q.length };
  }
  // サーバが受け取ったと答えた行だけ外す
  function perfQueueRemove(queue, mids) {
    var gone = {};
    (mids || []).forEach(function (m) { gone[m] = true; });
    return (queue || []).filter(function (r) { return !gone[r.mid]; });
  }
  // 送る形（端末の中だけで使う ts を外す）
  function perfWire(row) {
    var out = {};
    Object.keys(row).forEach(function (k) { if (k !== 'ts') out[k] = row[k]; });
    return out;
  }

  var api = {
    STATUSES: STATUSES, laneOf: laneOf, norm: norm, matchesQuery: matchesQuery, passesDays: passesDays, filterCards: filterCards,
    sortCards: sortCards, memoExcerpt: memoExcerpt, ageClass: ageClass, ageLabel: ageLabel, yen: yen, jpDate: jpDate,
    summarize: summarize, historyLines: historyLines, shortAt: shortAt, classifyResponse: classifyResponse,
    ALL_STAFF: ALL_STAFF, UNASSIGNED: UNASSIGNED, assigneeLabel: assigneeLabel, isUnassigned: isUnassigned, passesStaff: passesStaff,
    staffChoices: staffChoices, defaultStaff: defaultStaff, assigneeSaved: assigneeSaved, closeAfterSave: closeAfterSave, settledAssignee: settledAssignee, applyAssignee: applyAssignee,
    assigneeLines: assigneeLines, detailLines: detailLines,
    failureText: failureText, buildUpdate: buildUpdate, attentionItems: attentionItems, tokenSub: tokenSub, addIntent: addIntent, stashDraft: stashDraft,
    addLost: addLost, removeLostMemo: removeLostMemo, dismissLost: dismissLost,
    wishOf: wishOf, draftWish: draftWish, wishEmpty: wishEmpty, wishLines: wishLines, addWish: addWish,
    partnerAssigneeLocked: partnerAssigneeLocked, fetchInit: fetchInit, KEEPALIVE_MAX_BYTES: KEEPALIVE_MAX_BYTES,
    mergeRecords: mergeRecords, newerState: newerState, perfResult: perfResult, perfServerFields: perfServerFields,
    perfQueueAdd: perfQueueAdd, perfQueueRemove: perfQueueRemove, perfWire: perfWire, PERF_QUEUE_MAX: PERF_QUEUE_MAX
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArView = api;
})(this);
