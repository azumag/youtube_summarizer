// Gemini AIのウェブサイト用コンテンツスクリプト

// バックグラウンドスクリプトからのメッセージを受け取る
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "injectPrompt") {
    injectPromptAndSubmit(message.prompt);
    sendResponse({ success: true });
    return true;
  }
});

// ページが読み込まれたときに実行
document.addEventListener('DOMContentLoaded', () => {
  // Gemini AIのページが完全に読み込まれたことをバックグラウンドスクリプトに通知
  chrome.runtime.sendMessage({
    action: "geminiPageLoaded",
    url: window.location.href
  });
});

// プロンプトを入力して送信する関数
function injectPromptAndSubmit(prompt) {
  console.log('プロンプトを入力します:', prompt);
  
  // テキストエリアを探す
  const textareas = document.querySelectorAll('textarea');
  let promptTextarea = null;
  
  // プロンプト入力欄を探す
  for (const textarea of textareas) {
    if (textarea.placeholder && 
        (textarea.placeholder.includes('Gemini') || 
         textarea.placeholder.includes('質問') || 
         textarea.placeholder.includes('プロンプト'))) {
      promptTextarea = textarea;
      break;
    }
  }
  
  // テキストエリアが見つからない場合は、最後のテキストエリアを使用
  if (!promptTextarea && textareas.length > 0) {
    promptTextarea = textareas[textareas.length - 1];
  }
  
  if (promptTextarea) {
    // プロンプトを入力
    promptTextarea.value = prompt;
    
    // 入力イベントをトリガー
    promptTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    
    // 送信ボタンを探す
    setTimeout(() => {
      // 送信ボタンを探す（複数の可能性があるセレクタを試す）
      const sendButtons = [
        ...document.querySelectorAll('button[aria-label="送信"]'),
        ...document.querySelectorAll('button[aria-label="Submit"]'),
        ...document.querySelectorAll('button[type="submit"]'),
        ...document.querySelectorAll('button svg[viewBox]') // SVGアイコンを持つボタン
      ];
      
      // 送信ボタンが見つかった場合はクリック
      for (const button of sendButtons) {
        const actualButton = button.closest('button') || button;
        if (actualButton && actualButton.offsetParent !== null) { // 表示されているボタンのみ
          actualButton.click();
          console.log('送信ボタンをクリックしました');
          return;
        }
      }
      
      console.log('送信ボタンが見つかりませんでした');
    }, 500);
  } else {
    console.error('プロンプト入力欄が見つかりませんでした');
  }
}
