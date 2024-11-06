// ==UserScript==
// @name         EasyPayTotalSum
// @icon         https://easypay.ua/favicon.ico
// @match        https://easypay.ua/ua/profile/history
// @downloadURL  https://artas90.github.io/user-scripts/easypaytotalsum.user.js
// ==/UserScript==

(function() {
  'use strict';

  function calculate() {
    let totalSum = document.getElementById('EasyPayTotalSum');
    if(!totalSum) {
      totalSum = document.createElement('div');
      totalSum.id = "EasyPayTotalSum";
      totalSum.innerHTML = "--";
      totalSum.className = "light-box-shadow";
      totalSum.style.textAlign = "right";
      totalSum.style.paddingRight = "20px";
      totalSum.style.marginTop = "20px";

      const searchForm = document.getElementsByTagName('app-history-search-form')[0];
      searchForm.append(totalSum);
    }

    const historyItems = document.querySelectorAll('app-history-item .transaction_amount-total');
    let sumValue = 0;
    for (let el of historyItems) {
      sumValue += Number.parseFloat(el.innerHTML)
    }
    totalSum.innerHTML = "Сума: <strong>" + sumValue + "</strong>";

    setTimeout(calculate, 300);
  }
  setTimeout(calculate, 300);
})();
