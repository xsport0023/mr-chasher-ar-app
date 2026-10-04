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

  // 並び順: 経過日数の多い順／経過日数の少ない順（期日前の負の日数が先。ar-app-outcome 段1）／請求額の多い順／取引先名順。
  // 日数不明はどちらの日数順でも最後。同じなら請求番号順
  function sortCards(cards, sort) {
    var byNumber = function (a, b) { return String(a.billingNumber).localeCompare(String(b.billingNumber), 'ja', { numeric: true }); };
    var unknown = function (c) { return c.days === null || c.days === undefined; };
    var cmp;
    if (sort === 'amount') cmp = function (a, b) { return (b.amount || 0) - (a.amount || 0); };
    else if (sort === 'client') cmp = function (a, b) { return String(a.partner).localeCompare(String(b.partner), 'ja'); };
    else if (sort === 'age_asc') cmp = function (a, b) {
      if (unknown(a) || unknown(b)) return unknown(a) === unknown(b) ? 0 : (unknown(a) ? 1 : -1);
      return a.days - b.days;
    };
    else cmp = function (a, b) {
      var da = unknown(a) ? -Infinity : a.days;
      var db = unknown(b) ? -Infinity : b.days;
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

  // ---- 督促の支援 段1（plan_id = ar-app-dunning。計画 §3-3）: カードの最新の記録の1行 ----
  // サーバの last（連絡状況かメモを変えた最後の記録）から文言を作る。無ければ ''。言い回しは historyLines と同じ。
  // 例「10/02 14:31 小笠原 章洋　連絡状況: ノータッチ → 連絡済み」
  function lastActLine(last) {
    if (!last || typeof last !== 'object' || typeof last.recordId !== 'number') return '';
    var parts = [];
    if (last.statusChanged) parts.push('連絡状況: ' + (last.prev || 'ノータッチ') + ' → ' + last.status);
    if (last.memoChanged) parts.push(last.memoCleared ? 'メモを消去' : 'メモを更新');
    if (!parts.length) return '';
    var at = String(last.at || '');
    var when = /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/.test(at) ? at.slice(5, 16) : at;
    return (when ? when + ' ' : '') + (last.who ? last.who + '　' : '') + parts.join('／');
  }

  // カードの1行を進めるのは、届いた last の記録ID が今より大きいときだけ（K2 と同じ。古い応答で戻さない）。同じ ID は今のまま。
  // 欄が無い・null の応答（旧サーバなど）では今の1行を消さない（計画レビュー第1巡 指摘2）。
  // カードの lastRecordId・担当の assigneeRecordId とは比べない（担当だけの保存で lastRecordId は進むが、1行は進まない）
  function newerLast(cur, inc) {
    if (!inc || typeof inc !== 'object' || typeof inc.recordId !== 'number') return cur || null;
    return !cur || inc.recordId > (cur.recordId || 0) ? inc : cur;
  }

  // ---- 督促の支援 段3（plan_id = ar-app-dunning。計画 §3-1-3・§3-1-4）: 請求書 PDF ----

  // 履歴の後先: a が b より「後」か。ms の大きいほう、同じ ms なら印の文字の並びの大きいほう（サーバの arPdfOrderAfter_ と同じ規則）
  function pdfOrderAfter(a, b) {
    if (!a) return false;
    if (!b) return true;
    if (a.ms !== b.ms) return a.ms > b.ms;
    return a.id > b.id;
  }
  function pdfLastOk(x) {
    return !!x && typeof x === 'object' && !!x.order && typeof x.order.ms === 'number' && isFinite(x.order.ms) &&
      typeof x.order.id === 'string' && x.order.id !== '' && typeof x.at === 'string';
  }
  // 持っている値（prev）と届いた値（next）のうち「後」のほうを返す。形の合わない値・同じ値・前の値では置き換えない。
  // 届いた値が無くても持っている値は消さない（遅れて届いた古い一覧で、その場で付けた札を消さない。§3-1-4）
  function pdfLastPick(prev, next) {
    var p = pdfLastOk(prev) ? prev : null;
    var n = pdfLastOk(next) ? next : null;
    if (!n) return p;
    return pdfOrderAfter(n.order, p ? p.order : null) ? n : p;
  }
  // ボタンの下の1行「10/04 田中」（督促の支援 段4 §3-4-2。PDF と督促文で共通。at は yyyy/MM/dd HH:mm:ss で、時刻は出さない）。
  // 形の合わない値・at が yyyy/MM/dd で始まらない値は空。誰が無ければ月日だけ。段3 の帯の札 pdfLastLabel はこれに置き換えた
  function lastShortLabel(x) {
    if (!pdfLastOk(x)) return '';
    var m = /^\d{4}\/(\d{2})\/(\d{2})/.exec(x.at);
    if (!m) return '';
    return m[1] + '/' + m[2] + (x.who ? ' ' + x.who : '');
  }
  // 督促文のコピーの最後の1行（段4 §3-4-3）を種類ごとに、持っている値と届いた値の「後」のほうで決める（pdfLastPick と同じ規則）。
  // 届いた値に無い種類も、持っている値は消さない。どちらの種類も無ければ null
  function dunningLastPick(prev, next) {
    var out = null;
    DUNNING_KINDS.forEach(function (k) {
      var p = pdfLastPick(prev && typeof prev === 'object' ? prev[k] : null, next && typeof next === 'object' ? next[k] : null);
      if (p) { out = out || {}; out[k] = p; }
    });
    return out;
  }
  // 失敗の知らせ（帯の下の1行。§3-1-4）。認証の失敗は画面が handleAuthFailure へ渡すので、ここへは来ない
  function pdfFailText(r) {
    var k = r ? r.kind : 'network';
    if (k === 'timeout' || k === 'network') return '応答がありませんでした。もう一度押してください';
    if (k === 'fail') {
      var c = r.code;
      if (c === 'PAID_OR_OUT_OF_SCOPE' || c === 'NOT_FOUND') return '入金済みか対象外になりました。一覧を取り直してください';
      if (c === 'MF_ERROR') return 'MF 請求から取れませんでした（' + String(r.json && r.json.mfCode !== undefined && r.json.mfCode !== null ? r.json.mfCode : '—') + '）。少し時間を置いてもう一度押してください';
      if (c === 'PDF_URL_MISMATCH' || c === 'NOT_PDF' || c === 'PDF_TOO_LARGE') return 'この請求の PDF はここでは取れません。MF 請求の画面から取ってください';
    }
    return 'PDF を取れませんでした。もう一度押してください';
  }

  // ---- 督促の支援 段2（plan_id = ar-app-dunning。計画 §3-2-3・§3-2-5）: 督促文のコピー ----
  var DUNNING_KINDS = ['初回', '2回目'];
  var DUNNING_TAGS = /\{(取引先名|請求番号|件名|支払期限|請求金額)\}/g;

  // 一覧の応答から、持つ文面を決める（§3-2-5）。dunningTemplates が在れば丸ごと置き換える（形の合う行だけ）。
  // 読み失敗（dunningError）なら前の文面を保つ。どちらも無い（旧サーバ）なら空
  function dunningTemplatesOf(json, prev) {
    if (json && Array.isArray(json.dunningTemplates)) {
      var seen = {};
      return json.dunningTemplates.filter(function (t) {
        var ok = !!t && DUNNING_KINDS.indexOf(t.kind) >= 0 && typeof t.text === 'string' && t.text.trim() !== '' && !seen[t.kind];
        if (ok) seen[t.kind] = true;
        return ok;
      }).map(function (t) { return { kind: t.kind, text: t.text }; });
    }
    if (json && json.dunningError) return prev || [];
    return [];
  }

  // '2026-08-31' → '2026年8月31日'（月日の0を付けない）。形が違えば ''
  function dunningDate(ymd) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
    return m ? Number(m[1]) + '年' + Number(m[2]) + '月' + Number(m[3]) + '日' : '';
  }

  // 193864 → '193,864'（¥ は付けない。文面に「円」が在る）。正の整数でなければ ''
  function dunningAmount(n) {
    if (typeof n !== 'number' || !isFinite(n) || n <= 0 || Math.floor(n) !== n) return '';
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function blankText(v) { return v === null || v === undefined || String(v).trim() === ''; }

  // 督促文を作れない理由（作れるなら ''）。督促文は社外へ出るので、誤った値の文を作らない側に倒す（§3-2-3）
  function dunningBlock(card) {
    if (!card) return '請求が見つかりません';
    if (card.paidMark) return 'この請求は入金済みになりました。一覧を取り直してください';
    var lack = [];
    if (blankText(card.partner)) lack.push('取引先名');
    if (blankText(card.billingNumber)) lack.push('請求番号');
    if (!dunningDate(card.dueDate)) lack.push('支払期限');
    if (!dunningAmount(card.amount)) lack.push('請求金額');
    if (lack.length) return '請求の値（' + lack.join('・') + '）が欠けているため作れません';
    if (card.deduct !== 'none') return '差し引きのある（または有無が分からない）請求は、金額を確かめて手で作ってください';
    return '';
  }

  // 差し込み。全部の印を1回の走査で、関数で置き換える（値の中の {…}・$&・$1 は展開しない）。知らない {…} と「○○様」は残す。
  // 取引先名と件名は前後の空白（全角を含む）だけを取る（MF の件名の先頭に空白が入った請求があった。D2-4、ユーザー決定 A 2026-10-03）。
  // 呼ぶ前に dunningBlock が '' であることを確かめる
  function fillDunning(text, card) {
    var v = {
      '取引先名': String(card.partner).trim(),
      '請求番号': String(card.billingNumber),
      '件名': blankText(card.title) ? '（件名なし）' : String(card.title).trim(),
      '支払期限': dunningDate(card.dueDate),
      '請求金額': dunningAmount(card.amount)
    };
    return String(text).replace(DUNNING_TAGS, function (all, name) { return v[name]; });
  }

  // 差し込みの元の印（取引先名・請求番号・件名・支払期限・金額・文面）。一覧の取り直しで変わったかを見る（§3-2-5）
  function dunningSig(card, text) {
    return JSON.stringify([card ? card.partner : null, card ? card.billingNumber : null, card ? card.title : null,
      card ? card.dueDate : null, card ? card.amount : null, text === undefined ? null : text]);
  }

  // 失敗の欄（{ id, kind, text, fetchedAt, sig }）をどう描くか。text は今のその種類の文面（無ければ null）。
  //   'none'  … 描かない（欄が無い・開いている請求と違う）
  //   'clear' … 片付ける（作れなくなった・その種類の文面が消えた）
  //   'stale' … 文面を消し「もう一度押してください」とだけ出す（差し込みの元が変わった）
  //   'show'  … そのまま
  function dunningBoxState(fail, card, text) {
    if (!fail || !card || fail.id !== card.billingId) return 'none';
    if (text === null || text === undefined) return 'clear';
    if (dunningBlock(card)) return 'clear';
    if (fail.stale || dunningSig(card, text) !== fail.sig) return 'stale';
    return 'show';
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

  // ---- 段D: ドラッグの保存待ち（計画 ar-app-perf §9-3・§9-9・§9-10） ----
  // 保存待ち: 請求ID → { id, to（移す先）, base（受け付けたときの確定した記録ID）, partner, partnerId, billingNumber, owner, gen, seq, ctx }。
  // 同じ請求をまた動かしたら移す先だけを変え、確定した状態（confirmed）へ戻したら外す。base は最初のドラッグのときのまま（§9-3 の3）。
  // 返す値: added（新しく入れた）・changed（移す先を変えた）・removed（元へ戻したので外した）・none（何もしない）
  function moveAdd(moves, entry, confirmed) {
    var cur = Object.prototype.hasOwnProperty.call(moves, entry.id) ? moves[entry.id] : null;
    if (!cur) {
      if (entry.to === confirmed) return 'none';
      moves[entry.id] = entry;
      return 'added';
    }
    if (entry.to === cur.to) return 'none';
    if (entry.to === confirmed) { delete moves[entry.id]; return 'removed'; }
    cur.to = entry.to;
    if (entry.ctx) cur.ctx = entry.ctx;   // 計測は最後に落とした時点から
    return 'changed';
  }
  // 受け付けた順の先頭を、保存待ちから外して返す（送る直前に同期の処理の中で。§9-9-2）
  function moveTake(moves) {
    var first = null;
    Object.keys(moves).forEach(function (k) { if (!first || moves[k].seq < first.seq) first = moves[k]; });
    if (first) delete moves[first.id];
    return first;
  }
  // 移動の1件の結果から、送り出しを続けるか止めるかを決める（§9-9-2 の表・§9-10-2）。
  // 続けてよいのは、その請求だけの失敗と分かっている既知のコードだけ。BAD_REQUEST・知らないコード・サーバの問題は止める
  var MOVE_CONTINUE_CODES = ['CONFLICT', 'PAID_OR_OUT_OF_SCOPE', 'NOT_FOUND', 'PARTNER_UNKNOWN', 'PARTNER_CHANGED', 'CANCELLED'];
  function moveOutcome(r) {
    if (!r) return 'stop';
    if (r.kind === 'ok') return 'continue';
    if (r.kind !== 'fail') return 'unknown';   // 打ち切り・壊れた応答・通信の失敗: 確定の問い合わせで決める
    if (r.code === 'UNAUTHENTICATED' || r.code === 'FORBIDDEN') return 'auth';
    return MOVE_CONTINUE_CODES.indexOf(r.code) >= 0 ? 'continue' : 'stop';
  }
  // 送り出しが終わったときの、まとめの知らせ（§9-3 の10）
  // saved: 保存できた（確定で書けていたを含む）・failed: 書かれなかったと決まった・unknown: 確定でも決まらなかった（未確定）
  function moveSummary(saved, failed, unknown) {
    unknown = unknown || 0;
    if (!saved && !failed && !unknown) return null;
    if (!failed && !unknown) return { text: '✓ ' + saved + '件の移動を保存しました', kind: '' };
    return { text: (saved ? saved + '件の移動を保存しました。' : '') + (failed ? failed + '件の移動は保存できませんでした。' : '') +
      (unknown ? unknown + '件の移動は保存できたかを確かめられませんでした。' : '') + '「要確認」を見てください。', kind: 'error' };
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
  var PERF_SERVER_FIELDS = ['tokenMs', 'tokenCached', 'usersMs', 'mfMs', 'recordsMs', 'mfGetOneMs', 'lockMs'];   // lockMs は成果表示 ar-app-outcome §3-2
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

  // ---- 成果表示（plan_id = ar-app-outcome。計画 §3-2・§3-3） ----
  var OUTCOME_TABS = ['未入金', '未設定'];
  var SNAP_MAX_ITEMS = 1000;   // サーバの AR_SNAP_MAX_ITEMS と同じ。超えたら送らずに知らせる（実装レビュー第1巡 指摘3）

  // 描いた一覧から控えを作る（サーバの arSnapshotOf_ と同じ形。共通の印は付けない）
  function snapshotOf(tabs, fetchedAtMs) {
    var items = [];
    OUTCOME_TABS.forEach(function (tab, t) {
      ((tabs && tabs[tab]) || []).forEach(function (c) {
        items.push([c.billingId, t, Math.round(Number(c.amount) || 0), c.status === 'ノータッチ' ? 1 : 0]);
      });
    });
    return { f: fetchedAtMs, i: items };
  }

  // outcome の応答から、表示中のタブ・担当の選択での増減と「入金で解消」を出す。経過日数・検索は使わない（Q3）。
  // 担当は、今の一覧にある請求は今のカードの担当、入金で消えた請求はサーバが返した今の担当で見る。
  // cardsById は今の一覧（両タブ）の請求ID → カード。今の一覧に無い「新しく出てきた」請求は数えない（取り直しで消えたもの）
  function outcomeView(o, tab, staffSel, staffList, cardsById) {
    if (!o || !o.ok || o.baseAt === null || o.baseAt === undefined) return null;
    var mine = function (card) { return !!card && passesStaff(card, staffSel, staffList); };
    var added = (o.added || []).filter(function (x) { return x.tab === tab && mine(cardsById[x.id]); });
    var contacted = (o.contacted || []).filter(function (x) { return x.tab === tab && mine(cardsById[x.id]); });
    var paidAll = o.paidUnknown ? [] : (o.paid || []).filter(function (p) { return mine({ assignee: p.assignee || '' }); });
    var paidTab = paidAll.filter(function (p) { return p.tab === tab; });
    var sum = function (xs) { return xs.reduce(function (a, x) { return a + (x.amount || 0); }, 0); };
    // 入金か確かめられなかった（PAID_UNKNOWN）ときは、入金の － を出さない（null）。連絡で動かした未連絡の － だけ出す（§3-3）
    var minus = o.paidUnknown ? { count: null, amount: null, untouched: contacted.length } : {
      count: paidTab.length, amount: sum(paidTab),
      untouched: contacted.length + paidTab.filter(function (p) { return p.untouched; }).length
    };
    return {
      plus: { count: added.length, amount: sum(added), untouched: added.filter(function (x) { return x.untouched; }).length },
      minus: minus,
      paid: paidAll, paidTotal: sum(paidAll), paidUnknown: !!o.paidUnknown
    };
  }

  // ミリ秒 → 日本時間の「9/30 17:42」
  function jpDateTime(ms) {
    var s = new Date(ms + 9 * 60 * 60 * 1000).toISOString();
    return Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10)) + ' ' + s.slice(11, 16);
  }

  // 比べた時点の注記（UI-3。共通の控えは公開の時点。§3-7）
  function outcomeNote(o) {
    if (!o || !o.ok) return '';
    if (o.baseAt === null || o.baseAt === undefined) return '前回の記録がありません。次に開いたときから表示します。';
    return '前回（' + (o.common ? '公開の時点 ' : '') + jpDateTime(o.baseAt) + '）の一覧と比べています。日付が変わるまで同じ時点と比べます。タブと担当で比べ、経過日数・検索には関係しません。';
  }

  function deltaText(sign, v, money) {
    if (v === null || v === undefined) return sign + '—';
    return sign + (money ? yen(v) : v + '件');
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
    partnerAssigneeLocked: partnerAssigneeLocked, moveAdd: moveAdd, moveTake: moveTake, moveOutcome: moveOutcome, moveSummary: moveSummary, fetchInit: fetchInit, KEEPALIVE_MAX_BYTES: KEEPALIVE_MAX_BYTES,
    mergeRecords: mergeRecords, newerState: newerState, perfResult: perfResult, perfServerFields: perfServerFields,
    perfQueueAdd: perfQueueAdd, perfQueueRemove: perfQueueRemove, perfWire: perfWire, PERF_QUEUE_MAX: PERF_QUEUE_MAX,
    snapshotOf: snapshotOf, outcomeView: outcomeView, outcomeNote: outcomeNote, jpDateTime: jpDateTime, deltaText: deltaText, SNAP_MAX_ITEMS: SNAP_MAX_ITEMS,
    lastActLine: lastActLine, newerLast: newerLast,
    DUNNING_KINDS: DUNNING_KINDS, dunningTemplatesOf: dunningTemplatesOf, dunningDate: dunningDate, dunningAmount: dunningAmount,
    dunningBlock: dunningBlock, fillDunning: fillDunning, dunningSig: dunningSig, dunningBoxState: dunningBoxState,
    pdfOrderAfter: pdfOrderAfter, pdfLastPick: pdfLastPick, pdfFailText: pdfFailText,
    lastShortLabel: lastShortLabel, dunningLastPick: dunningLastPick,
    VERSION: '2026-10-04.dunning.7'   // index.html の VIEW_VERSION と <script src="ar-view.js?v=…"> と同じ（版の印。2026-10-04）
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ArView = api;
})(this);
