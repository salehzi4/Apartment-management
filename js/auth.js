// ============================================================================
//  عميل Supabase المشترك + أدوات المصادقة (المستوى ج)
//  تستخدمه الصدفة والوحدتان. الجلسة تُحفظ تلقائياً في localStorage،
//  فيكفي تسجيل الدخول مرة واحدة من الصدفة وتعمل كل الوحدات.
// ============================================================================
(function () {
  'use strict';
  if (!window.APP_CONFIG || !window.APP_CONFIG.SUPABASE_URL) {
    console.error('APP_CONFIG غير مُعدّ — راجع js/config.js');
  }
  // عميل واحد مشترك (نفس مفتاح التخزين => نفس الجلسة عبر الوحدات)
  window.sbClient = supabase.createClient(
    window.APP_CONFIG.SUPABASE_URL,
    window.APP_CONFIG.SUPABASE_ANON_KEY,
    { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'property-system-auth' } }
  );

  window.Auth = {
    client: window.sbClient,
    async getUser() {
      try { var r = await window.sbClient.auth.getUser(); return r.data ? r.data.user : null; }
      catch (e) { return null; }
    },
    async signIn(email, password) {
      return await window.sbClient.auth.signInWithPassword({ email: email, password: password });
    },
    async signOut() { return await window.sbClient.auth.signOut(); },
    onChange(cb) { return window.sbClient.auth.onAuthStateChange(cb); }
  };
})();
