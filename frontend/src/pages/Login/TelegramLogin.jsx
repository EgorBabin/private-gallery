import { useEffect } from 'react';

export default function TelegramLogin() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', 'LoggerGalleryBot');
    script.setAttribute('data-size', 'large');
    script.setAttribute(
      'data-auth-url',
      'https://192.168.0.167:5173/api/telegram/',
    );
    document.getElementById('telegram-login-btn').appendChild(script);
  }, []);

  return <div id="telegram-login-btn"></div>;
}
