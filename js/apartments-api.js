// ============================================================================
//  وحدة إدارة الشقق — طبقة البيانات على Supabase
//  تحاكي google.script.run الأصلي: نفس أسماء الدوال ونفس أشكال المخرجات،
//  لكنها تقرأ/تكتب في Supabase بدل Google Sheets. فتعمل الواجهة الأصلية دون تعديل.
//
//  يعتمد على: supabase-js (CDN) + js/config.js (window.APP_CONFIG)
// ============================================================================
(function () {
  'use strict';

  var sb = supabase.createClient(window.APP_CONFIG.SUPABASE_URL, window.APP_CONFIG.SUPABASE_ANON_KEY);

  // ---------- أدوات مساعدة (منقولة من النظام الأصلي) ----------
  function generateId() {
    return 'AP_' + new Date().getTime() + '_' + Math.floor(Math.random() * 1000);
  }
  function formatDate(d) {
    if (!d) return '';
    return String(d).substring(0, 10);
  }
  function normalizeMonth(value) {
    if (!value && value !== 0) return '';
    var str = String(value).trim();
    if (str.length >= 7 && str.charAt(4) === '-') return str.substring(0, 7);
    return str;
  }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function dateOrNull(v) { v = (v || '').toString().trim(); return v === '' ? null : v; }

  function listContractMonths(startDate, endDate) {
    if (!startDate || !endDate) return [];
    var start = new Date(startDate), end = new Date(endDate);
    if (start > end) return [];
    var months = [];
    var cur = new Date(start.getFullYear(), start.getMonth(), 1);
    var endM = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cur <= endM) {
      months.push(cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0'));
      cur.setMonth(cur.getMonth() + 1);
    }
    return months;
  }
  function findDueScheduleForMonth(schedule, month) {
    if (!schedule || !Array.isArray(schedule) || !schedule.length || !month) return null;
    var p = month.split('-');
    var mStart = new Date(parseInt(p[0]), parseInt(p[1]) - 1, 1);
    var mEnd = new Date(parseInt(p[0]), parseInt(p[1]), 0);
    for (var i = 0; i < schedule.length; i++) {
      var s = schedule[i];
      if (!s.from || !s.to) continue;
      if (mEnd >= new Date(s.from) && mStart <= new Date(s.to)) {
        return { from: s.from, to: s.to, amount: num(s.amount) };
      }
    }
    return null;
  }

  // ---------- تحويل صفوف الجداول إلى الأشكال التي تتوقّعها الواجهة ----------
  function rowToApartment(a) {
    var payments = [], schedule = [];
    try { payments = JSON.parse(a.payments_json || '[]'); } catch (e) { payments = []; }
    try { schedule = JSON.parse(a.payment_schedule_json || '[]'); } catch (e) { schedule = []; }
    return {
      id: a.id,
      contractNumber: a.contract_number || '',
      apartmentName: a.name || '',
      tenantName: a.tenant_name || '',
      utilities: a.utilities || '',
      startDate: a.start_date ? formatDate(a.start_date) : '',
      endDate: a.end_date ? formatDate(a.end_date) : '',
      totalRent: a.total_rent || 0,
      paymentsCount: a.payments_count || 1,
      payments: payments,
      externalCode: a.billing_code || '',
      paymentSchedule: schedule,
      fullyPaid: a.fully_paid === true,
      displayOrder: (a.display_order != null) ? a.display_order : 0,
      createdAt: a.created_or_schedule_raw
    };
  }
  function rowToMonthly(m) {
    return {
      rentStatus: m.rent_status || '',
      utilitiesStatus: m.utilities_status || '',
      paymentMethod: m.payment_method || '',
      paymentDate: m.payment_date ? formatDate(m.payment_date) : '',
      rentAmount: m.rent_amount || 0,
      utilitiesAmount: m.utilities_amount || 0,
      notes: m.notes || '',
      otherOverdue: num(m.other_overdue)
    };
  }

  // ---------- ملخص الشقة (منقول حرفياً من buildApartmentSummary) ----------
  function buildApartmentSummary(apt, monthlyData) {
    var contractMonths = listContractMonths(apt.startDate, apt.endDate);
    var totalRent = num(apt.totalRent);
    var paidRentAmount = 0, paidRentCount = 0, overdueRentAmount = 0;
    var overdueRentMonths = [], overdueUtilitiesAmount = 0, overdueUtilitiesMonths = [];
    var otherOverdueAmount = 0, otherOverdueMonths = [], monthlyRows = [];

    for (var i = 0; i < contractMonths.length; i++) {
      var month = contractMonths[i];
      var data = monthlyData[month] || {};
      var rentStatus = data.rentStatus || '';
      var rentAmount = num(data.rentAmount);
      var utilitiesStatus = data.utilitiesStatus || '';
      var utilitiesAmount = num(data.utilitiesAmount);
      var notes = data.notes || '';
      var otherOverdue = num(data.otherOverdue);
      var displayRentStatus = rentStatus, displayRentAmount = rentAmount;

      if (!rentStatus) {
        if (apt.fullyPaid) {
          displayRentStatus = 'paid';
          var due1 = findDueScheduleForMonth(apt.paymentSchedule, month);
          displayRentAmount = due1 ? due1.amount : (totalRent / contractMonths.length);
        } else {
          var due2 = findDueScheduleForMonth(apt.paymentSchedule, month);
          if (due2) { displayRentStatus = 'pending'; displayRentAmount = due2.amount; }
          else { displayRentStatus = 'none'; displayRentAmount = 0; }
        }
      }
      if (displayRentStatus === 'paid') { paidRentAmount += displayRentAmount; paidRentCount++; }
      else if (displayRentStatus === 'unpaid') { overdueRentAmount += displayRentAmount; overdueRentMonths.push({ month: month, amount: displayRentAmount }); }

      if (utilitiesStatus === 'unpaid' && utilitiesAmount > 0) {
        overdueUtilitiesAmount += utilitiesAmount;
        overdueUtilitiesMonths.push({ month: month, amount: utilitiesAmount });
      }
      if (otherOverdue > 0) { otherOverdueAmount += otherOverdue; otherOverdueMonths.push({ month: month, amount: otherOverdue, notes: notes }); }

      monthlyRows.push({
        month: month, rentStatus: displayRentStatus, rentAmount: displayRentAmount,
        utilitiesStatus: utilitiesStatus, utilitiesAmount: utilitiesAmount,
        paymentMethod: data.paymentMethod || '', paymentDate: data.paymentDate || '',
        notes: notes, otherOverdue: otherOverdue
      });
    }

    var remainingRent = totalRent - paidRentAmount - overdueRentAmount;
    if (remainingRent < 0) remainingRent = 0;
    var endDate = apt.endDate ? new Date(apt.endDate) : null;
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var daysRemaining = endDate ? Math.ceil((endDate - today) / 86400000) : null;
    var totalOverdue = overdueRentAmount + overdueUtilitiesAmount + otherOverdueAmount;
    var r2 = function (x) { return Math.round(x * 100) / 100; };

    return {
      id: apt.id, contractNumber: apt.contractNumber || '', apartmentName: apt.apartmentName || '',
      tenantName: apt.tenantName || '', startDate: apt.startDate || '', endDate: apt.endDate || '',
      totalRent: totalRent, paymentsCount: apt.paymentsCount || 0, fullyPaid: apt.fullyPaid === true,
      externalCode: apt.externalCode || '', contractMonthsCount: contractMonths.length,
      daysRemaining: daysRemaining, paidRentAmount: r2(paidRentAmount), paidRentCount: paidRentCount,
      overdueRentAmount: r2(overdueRentAmount), overdueRentMonths: overdueRentMonths,
      remainingRent: r2(remainingRent), overdueUtilitiesAmount: r2(overdueUtilitiesAmount),
      overdueUtilitiesMonths: overdueUtilitiesMonths, otherOverdueAmount: r2(otherOverdueAmount),
      otherOverdueMonths: otherOverdueMonths, totalOverdue: r2(totalOverdue), monthlyRows: monthlyRows
    };
  }

  // ---------- قراءات أساسية ----------
  async function fetchApartments() {
    var res = await sb.from('apartments').select('*');
    if (res.error) throw res.error;
    var list = (res.data || []).map(rowToApartment);
    list.sort(function (a, b) { return (a.displayOrder || 0) - (b.displayOrder || 0); });
    return list;
  }
  async function fetchAllMonthly() {
    var res = await sb.from('monthly_records').select('*');
    if (res.error) throw res.error;
    return res.data || [];
  }

  // ============================ الدوال الـ 12 ============================
  var backend = {
    async getInitialData(currentMonth) {
      try {
        var apartments = await fetchApartments();
        var mrows = await fetchAllMonthly();
        var monthData = {}, paidCounts = {}, allMonthlyData = {};
        var target = normalizeMonth(currentMonth);
        mrows.forEach(function (m) {
          var aptId = String(m.apartment_id || '').trim(); if (!aptId) return;
          var rowMonth = normalizeMonth(m.month);
          var rd = rowToMonthly(m);
          if (!allMonthlyData[aptId]) allMonthlyData[aptId] = {};
          allMonthlyData[aptId][rowMonth] = rd;
          if (target && rowMonth === target) monthData[aptId] = rd;
          if (m.rent_status === 'paid') paidCounts[aptId] = (paidCounts[aptId] || 0) + 1;
        });
        return { success: true, apartments: apartments, monthData: monthData, paidCounts: paidCounts, allMonthlyData: allMonthlyData, currentMonth: currentMonth };
      } catch (e) {
        return { success: false, message: 'خطأ: ' + e.message, apartments: [], monthData: {}, paidCounts: {}, allMonthlyData: {} };
      }
    },

    async getMonthlyData(month) {
      try {
        var mrows = await fetchAllMonthly();
        var target = normalizeMonth(month);
        var data = {}, paidCounts = {}, allMonthlyData = {};
        mrows.forEach(function (m) {
          var aptId = String(m.apartment_id || '').trim(); if (!aptId) return;
          var rowMonth = normalizeMonth(m.month);
          var rd = rowToMonthly(m);
          if (!allMonthlyData[aptId]) allMonthlyData[aptId] = {};
          allMonthlyData[aptId][rowMonth] = rd;
          if (rowMonth === target) data[aptId] = rd;
          if (m.rent_status === 'paid') paidCounts[aptId] = (paidCounts[aptId] || 0) + 1;
        });
        return { success: true, data: data, paidCounts: paidCounts, allMonthlyData: allMonthlyData };
      } catch (e) {
        return { success: false, message: 'خطأ: ' + e.message, data: {}, paidCounts: {}, allMonthlyData: {} };
      }
    },

    async addApartment(data) {
      try {
        var cnt = await sb.from('apartments').select('id', { count: 'exact', head: true });
        var order = cnt.count || 0;
        var row = {
          id: generateId(),
          contract_number: data.contractNumber || '',
          name: data.apartmentName || '',
          tenant_name: data.tenantName || '',
          utilities: data.utilities || '',
          start_date: dateOrNull(data.startDate),
          end_date: dateOrNull(data.endDate),
          total_rent: num(data.totalRent),
          payments_count: data.paymentsCount || 1,
          payments_json: JSON.stringify(data.payments || []),
          billing_code: (data.externalCode && data.externalCode.trim()) ? data.externalCode.trim() : null,
          payment_schedule_json: JSON.stringify(data.paymentSchedule || []),
          fully_paid: !!data.fullyPaid,
          display_order: order,
          created_or_schedule_raw: new Date().toISOString()
        };
        var res = await sb.from('apartments').insert(row);
        if (res.error) throw res.error;
        return { success: true, id: row.id, message: 'تمت إضافة الشقة بنجاح' };
      } catch (e) { return { success: false, message: 'خطأ: ' + e.message }; }
    },

    async updateApartment(data) {
      try {
        var patch = {
          contract_number: data.contractNumber || '',
          name: data.apartmentName || '',
          tenant_name: data.tenantName || '',
          utilities: data.utilities || '',
          start_date: dateOrNull(data.startDate),
          end_date: dateOrNull(data.endDate),
          total_rent: num(data.totalRent),
          payments_count: data.paymentsCount || 1,
          payments_json: JSON.stringify(data.payments || []),
          billing_code: (data.externalCode && data.externalCode.trim()) ? data.externalCode.trim() : null,
          payment_schedule_json: JSON.stringify(data.paymentSchedule || []),
          fully_paid: !!data.fullyPaid
        };
        var res = await sb.from('apartments').update(patch).eq('id', data.id);
        if (res.error) throw res.error;
        return { success: true, message: 'تم التحديث بنجاح' };
      } catch (e) { return { success: false, message: 'خطأ: ' + e.message }; }
    },

    async deleteApartment(id) {
      try {
        var d1 = await sb.from('monthly_records').delete().eq('apartment_id', id);
        if (d1.error) throw d1.error;
        var d2 = await sb.from('apartments').delete().eq('id', id);
        if (d2.error) throw d2.error;
        return { success: true, message: 'تم الحذف بنجاح' };
      } catch (e) { return { success: false, message: 'خطأ: ' + e.message }; }
    },

    async saveMonthlyData(data) {
      try {
        var r = await saveOneMonthly(data);
        if (!r.ok) throw new Error(r.error || 'فشل الحفظ');
        return { success: true, message: 'تم الحفظ', month: normalizeMonth(data.month) };
      } catch (e) { return { success: false, message: 'خطأ: ' + e.message }; }
    },

    async batchSaveMonthlyData(items) {
      try {
        if (!items || !items.length) return { success: false, message: 'لا توجد بيانات للحفظ', saved: 0 };
        var saved = 0, failed = 0;
        for (var i = 0; i < items.length; i++) {
          var r = await saveOneMonthly(items[i]);
          if (r.ok) saved++; else failed++;
        }
        return { success: true, saved: saved, failed: failed, message: 'تم حفظ ' + saved + ' شقة' + (failed > 0 ? ' (فشل ' + failed + ')' : '') };
      } catch (e) { return { success: false, message: 'خطأ: ' + e.message, saved: 0 }; }
    },

    async batchGetBillingTotals(requests) {
      try {
        if (!requests || !requests.length) return { success: true, results: [] };
        var codes = [], months = [], cs = {}, ms = {};
        requests.forEach(function (r) {
          if (r.externalCode && !cs[r.externalCode]) { cs[r.externalCode] = 1; codes.push(r.externalCode); }
          if (r.month && !ms[r.month]) { ms[r.month] = 1; months.push(r.month); }
        });
        if (!codes.length || !months.length) return { success: true, results: [] };
        var res = await sb.from('apartment_records').select('apartment_code,bill_month,total').in('apartment_code', codes).in('bill_month', months);
        if (res.error) throw res.error;
        var totals = {};
        (res.data || []).forEach(function (r) {
          if (!r.apartment_code || !r.bill_month) return;
          var k = r.apartment_code + '|' + r.bill_month;
          if (!totals[k]) totals[k] = { total: 0, count: 0 };
          totals[k].total += num(r.total); totals[k].count++;
        });
        var results = requests.map(function (req) {
          var t = totals[(req.externalCode || '') + '|' + (req.month || '')] || { total: 0, count: 0 };
          return { externalCode: req.externalCode, month: req.month, total: Math.round(t.total * 100) / 100, count: t.count };
        });
        return { success: true, results: results };
      } catch (e) { return { success: false, message: 'خطأ: ' + e.message, results: [] }; }
    },

    async getBillingTotalForMonth(externalCode, month) {
      try {
        if (!externalCode) return { success: false, message: 'كود الشقة غير محدد', total: 0 };
        if (!month) return { success: false, message: 'الشهر غير محدد', total: 0 };
        var res = await sb.from('apartment_records').select('total,period,bill_month').eq('apartment_code', externalCode).eq('bill_month', month);
        if (res.error) throw res.error;
        var rows = res.data || [], total = 0, details = [];
        rows.forEach(function (r) { var a = num(r.total); total += a; details.push({ period: r.period || '', amount: a }); });
        return { success: true, total: Math.round(total * 100) / 100, count: rows.length, details: details,
                 message: rows.length ? ('تم جلب ' + rows.length + ' فاتورة') : 'لا توجد فواتير لهذه الشقة في الشهر المحدد' };
      } catch (e) { return { success: false, message: 'خطأ: ' + e.message, total: 0 }; }
    },

    async getApartmentsSummary() {
      try {
        var initial = await backend.getInitialData(null);
        if (!initial.success) return { success: false, message: initial.message, data: [] };
        var apartments = initial.apartments || [], allMonthly = initial.allMonthlyData || {};
        var summaries = apartments.map(function (apt) { return buildApartmentSummary(apt, allMonthly[apt.id] || {}); });
        return { success: true, data: summaries };
      } catch (e) { return { success: false, message: 'خطأ: ' + e.message, data: [] }; }
    },

    async saveApartmentsOrder(orderedIds) {
      try {
        if (!orderedIds || !orderedIds.length) return { success: false, message: 'لا توجد بيانات ترتيب' };
        var updated = 0;
        for (var k = 0; k < orderedIds.length; k++) {
          var res = await sb.from('apartments').update({ display_order: k }).eq('id', String(orderedIds[k]));
          if (!res.error) updated++;
        }
        return { success: true, message: 'تم حفظ الترتيب', updated: updated };
      } catch (e) { return { success: false, message: 'خطأ: ' + e.message }; }
    },

    async getBillingApartmentCodes() {
      try {
        var res = await sb.from('billing_units').select('apartment_code,section,apartment,type');
        if (res.error) throw res.error;
        var codes = (res.data || []).filter(function (r) { return r.apartment_code; }).map(function (r) {
          return { code: r.apartment_code, section: r.section || '', apartment: r.apartment || '', type: r.type || '',
                   displayName: (r.section || '') + ' - ' + (r.apartment || '') + (r.type ? ' (' + r.type + ')' : '') };
        });
        codes.sort(function (a, b) { return a.displayName.localeCompare(b.displayName, 'ar'); });
        return { success: true, data: codes, count: codes.length };
      } catch (e) { return { success: false, message: 'خطأ: ' + e.message, data: [] }; }
    }
  };

  // upsert يدوي (فحص ثم تحديث/إدراج) — يطابق منطق saveMonthlyData الأصلي ويحافظ على المعرّف
  async function saveOneMonthly(data) {
    if (!data || !data.apartmentId || !data.month) return { ok: false, error: 'بيانات ناقصة' };
    var month = normalizeMonth(data.month);
    var fields = {
      rent_status: data.rentStatus || '',
      utilities_status: data.utilitiesStatus || '',
      payment_method: data.paymentMethod || '',
      payment_date: dateOrNull(data.paymentDate),
      rent_amount: num(data.rentAmount),
      utilities_amount: num(data.utilitiesAmount),
      notes: data.notes || '',
      other_overdue: num(data.otherOverdue),
      updated_at: new Date().toISOString()
    };
    var ex = await sb.from('monthly_records').select('id').eq('apartment_id', String(data.apartmentId)).eq('month', month).maybeSingle();
    if (ex.error && ex.error.code !== 'PGRST116') return { ok: false, error: ex.error.message };
    if (ex.data && ex.data.id) {
      var up = await sb.from('monthly_records').update(fields).eq('id', ex.data.id);
      return up.error ? { ok: false, error: up.error.message } : { ok: true };
    } else {
      fields.id = generateId(); fields.apartment_id = String(data.apartmentId); fields.month = month;
      var ins = await sb.from('monthly_records').insert(fields);
      return ins.error ? { ok: false, error: ins.error.message } : { ok: true };
    }
  }

  // ---------- محاكاة google.script.run (chainable) ----------
  function makeRunner(onSuccess, onFailure) {
    var runner = {
      withSuccessHandler: function (fn) { return makeRunner(fn, onFailure); },
      withFailureHandler: function (fn) { return makeRunner(onSuccess, fn); }
    };
    Object.keys(backend).forEach(function (name) {
      runner[name] = function () {
        var args = Array.prototype.slice.call(arguments);
        Promise.resolve().then(function () { return backend[name].apply(backend, args); })
          .then(function (r) { if (onSuccess) onSuccess(r); })
          .catch(function (e) { if (onFailure) onFailure(e); else console.error('[apartments-api]', name, e); });
        return runner;
      };
    });
    return runner;
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = makeRunner(null, null);
})();
