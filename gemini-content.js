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
  console.log('Gemini AIページにプロンプトを注入します:', prompt);
  
  // DOM要素を探す関数
  function findElementByMultipleSelectors(selectors) {
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        if (elements && elements.length > 0) {
          return elements[0];
        }
      } catch (e) {
        console.error(`セレクタ ${selector} でのエラー:`, e);
      }
    }
    return null;
  }
  
  // ページの状態をログに出力（デバッグ用）
  console.log('ページ内のテキストエリア数:', document.querySelectorAll('textarea').length);
  console.log('ページ内のボタン数:', document.querySelectorAll('button').length);
  
  // テキストエリアを探す（複数の方法を試す）
  let promptTextarea = null;
  
  // 方法1: プレースホルダーで探す
  const textareas = document.querySelectorAll('textarea');
  for (const textarea of textareas) {
    console.log('テキストエリアのプレースホルダー:', textarea.placeholder);
    if (textarea.placeholder && 
        (textarea.placeholder.includes('Gemini') || 
         textarea.placeholder.includes('質問') || 
         textarea.placeholder.includes('プロンプト') ||
         textarea.placeholder.includes('Message') ||
         textarea.placeholder.includes('メッセージ'))) {
      promptTextarea = textarea;
      console.log('プレースホルダーでテキストエリアを見つけました');
      break;
    }
  }
  
  // 方法2: 特定のセレクタで探す
  if (!promptTextarea) {
    const textareaSelectors = [
      'textarea[placeholder]',
      'textarea.message-input',
      'textarea.prompt-input',
      'textarea.gemini-input',
      'div[contenteditable="true"]',
      'div[role="textbox"]'
    ];
    
    promptTextarea = findElementByMultipleSelectors(textareaSelectors);
    if (promptTextarea) {
      console.log('セレクタでテキストエリアを見つけました');
    }
  }
  
  // 方法3: 最後のテキストエリアを使用
  if (!promptTextarea && textareas.length > 0) {
    promptTextarea = textareas[textareas.length - 1];
    console.log('最後のテキストエリアを使用します');
  }
  
  if (promptTextarea) {
    console.log('テキストエリアが見つかりました。プロンプトを入力します');
    
    // プロンプトを入力
    promptTextarea.value = prompt;
    promptTextarea.textContent = prompt; // contenteditable要素の場合
    
    // 複数のイベントをトリガー
    const events = ['input', 'change', 'keyup', 'keydown', 'keypress'];
    events.forEach(eventType => {
      promptTextarea.dispatchEvent(new Event(eventType, { bubbles: true }));
    });
    
    // Enterキーイベントをシミュレート
    promptTextarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true
    }));
    
    // 送信ボタンを探す
    setTimeout(() => {
      // 送信ボタンを探す（複数の可能性があるセレクタを試す）
      const buttonSelectors = [
        'button[aria-label="送信"]',
        'button[aria-label="Submit"]',
        'button[type="submit"]',
        'button.submit-button',
        'button.send-button',
        'button svg[viewBox]', // SVGアイコンを持つボタン
        'button[data-test-id="send-button"]',
        'button.primary'
      ];
      
      const sendButton = findElementByMultipleSelectors(buttonSelectors);
      
      if (sendButton) {
        console.log('送信ボタンが見つかりました。クリックします');
        sendButton.click();
        return;
      }
      
      // ボタンが見つからない場合は、すべてのボタンをログに出力（デバッグ用）
      console.log('送信ボタンが見つかりませんでした。すべてのボタンを確認:');
      document.querySelectorAll('button').forEach((btn, i) => {
        console.log(`ボタン ${i}:`, btn.outerHTML);
      });
      
      // Enterキーイベントを再度送信（ボタンが見つからない場合）
      promptTextarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      }));
      
    }, 1000); // ボタンを探すまでの待機時間を長めに設定
  } else {
    console.error('プロンプト入力欄が見つかりませんでした。ページ構造:', document.body.innerHTML.substring(0, 500) + '...');
  }
}
