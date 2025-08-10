import styles from './Footer.module.css';

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <p>© {new Date().getFullYear()} Моя галерея. Все права защищены.</p>
    </footer>
  );
}
