export const metadata = {
  title: '9router Cloud',
  description: 'Hosted AI router for coding tools.'
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
