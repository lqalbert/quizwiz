(function () {
  var TOKEN_KEY = 'quizwiz_admin_token';

  window.QuizWizAuth = {
    getToken: function () {
      return localStorage.getItem(TOKEN_KEY);
    },
    setToken: function (t) {
      localStorage.setItem(TOKEN_KEY, t);
    },
    clearToken: function () {
      localStorage.removeItem(TOKEN_KEY);
    },
    getAuthHeaders: function () {
      var t = this.getToken();
      if (!t) return {};
      return { Authorization: 'Bearer ' + t };
    },
    requireLogin: function () {
      if (!this.getToken()) {
        location.href = '/admin-ui/login.html';
        return false;
      }
      return true;
    },
    logout: function () {
      this.clearToken();
      location.href = '/admin-ui/login.html';
    },
    handleResponse: function (res) {
      if (res.status === 401) {
        this.clearToken();
        location.href = '/admin-ui/login.html';
        return null;
      }
      return res;
    },
  };
})();
