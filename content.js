// YouTubeページでの処理を行うコンテンツスクリプト

// バックグラウンドスクリプトからのメッセージを受け取る
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getVideoInfo") {
    // 現在のYouTubeページからビデオ情報を取得
    const videoInfo = getVideoInfo();
    sendResponse(videoInfo);
    return true;
  }
});

// YouTubeページからビデオ情報を取得する関数
function getVideoInfo() {
  // 情報取得を複数回試行するために使用する配列
  const selectors = {
    title: [
      'h1.title',
      'h1.style-scope.ytd-watch-metadata',
      '#title h1',
      '#title'
    ],
    description: [
      'meta[name="description"]',
      '#description-text',
      '#description',
      '#info-container #description'
    ],
    channelName: [
      'div#owner-name a',
      '#channel-name a',
      '#owner-name a',
      '#channel-name',
      '#owner .ytd-channel-name'
    ],
    duration: [
      '.ytp-time-duration',
      'span.ytp-time-duration',
      'span[role="text"].ytd-thumbnail-overlay-time-status-renderer'
    ],
    publishDate: [
      '#info-strings yt-formatted-string',
      '#info-text',
      '#upload-info',
      '#info-text .published-date'
    ]
  };

  // セレクタ配列から最初に見つかった要素のテキストを取得する関数
  const getTextFromSelectors = (selectorArray, attributeName = null) => {
    for (const selector of selectorArray) {
      const element = document.querySelector(selector);
      if (element) {
        if (attributeName) {
          return element[attributeName] || element.getAttribute(attributeName) || '';
        }
        return element.textContent.trim() || '';
      }
    }
    return '';
  };
  
  // YouTubeの説明欄を展開する試み
  try {
    const moreButton = document.querySelector('#description tp-yt-paper-button#expand') || 
                        document.querySelector('#description #expand') ||
                        document.querySelector('#more');
    if (moreButton) {
      moreButton.click();
      // 少し待って説明が展開されるのを待つ
      setTimeout(() => {}, 500);
    }
  } catch (e) {
    console.warn('説明の展開に失敗しました', e);
  }
  
  // 値を取得
  const title = getTextFromSelectors(selectors.title) || document.title;
  // 説明は特別な処理（metaタグの場合はcontentを取得）
  let description = '';
  const descElement = document.querySelector('meta[name="description"]');
  if (descElement) {
    description = descElement.content || '';
  } else {
    description = getTextFromSelectors(selectors.description);
  }
  
  // 他の情報を取得
  const channelName = getTextFromSelectors(selectors.channelName);
  const duration = getTextFromSelectors(selectors.duration);
  const publishDate = getTextFromSelectors(selectors.publishDate);
  
  // タグ情報を取得（SEO情報として有用）
  const metaTags = document.querySelectorAll('meta[property="og:video:tag"]');
  const tags = Array.from(metaTags).map(tag => tag.content || '').filter(Boolean);
  
  // カテゴリを取得
  const category = document.querySelector('meta[itemprop="genre"]')?.content || '';
  
  return {
    title,
    description,
    channelName,
    duration,
    publishDate,
    url: window.location.href,
    tags: tags.join(', '),
    category
  };
}

// YouTubeのリンクにコンテキストメニューを追加するための処理
document.addEventListener('mousedown', (event) => {
  // 右クリックされた要素がYouTubeの動画リンクかどうかを確認
  if (event.button === 2) { // 右クリック
    const target = event.target.closest('a');
    if (target && isYouTubeVideoLink(target.href)) {
      // この要素は右クリックメニューでの処理対象
      chrome.runtime.sendMessage({
        action: "enableContextMenu",
        linkUrl: target.href
      });
    }
  }
});

// URLがYouTube動画リンクかどうかを判定する関数
function isYouTubeVideoLink(url) {
  if (!url) return false;
  return url.includes('youtube.com/watch?v=') || url.includes('youtu.be/');
}
