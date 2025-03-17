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
  // タイトルを取得
  const title = document.querySelector('h1.title')?.textContent || 
                document.querySelector('h1.style-scope.ytd-watch-metadata')?.textContent || 
                document.title;
  
  // 説明文を取得
  const description = document.querySelector('meta[name="description"]')?.content || 
                      document.querySelector('#description-text')?.textContent || 
                      '';
  
  // チャンネル名を取得
  const channelName = document.querySelector('div#owner-name a')?.textContent || 
                      document.querySelector('#channel-name a')?.textContent || 
                      '';
  
  // 動画の長さを取得
  const duration = document.querySelector('.ytp-time-duration')?.textContent || '';
  
  // 投稿日を取得
  const publishDate = document.querySelector('#info-strings yt-formatted-string')?.textContent || 
                      document.querySelector('#info-text')?.textContent || 
                      '';
  
  return {
    title,
    description,
    channelName,
    duration,
    publishDate,
    url: window.location.href
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
