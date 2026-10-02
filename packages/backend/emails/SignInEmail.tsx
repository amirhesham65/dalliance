import { Body, Button, Container, Head, Hr, Html, Link, Preview, Section, Text } from '@react-email/components'

// The website's palette, from @dalliance/brand's theme.css, written out because email clients take no CSS variables
const paper = '#f7f6f3'
const card = '#ffffff'
const ink = '#1d1d1b'
const soft = '#3f3e3a'
const subtle = '#6b6a65'
const hairline = '#e7e6e2'
const brand = '#1f3b2d'
const onBrand = '#f6f7f4'
const sans = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif'
const serif = '"Source Serif 4", Georgia, "Times New Roman", serif'

/** The email with a sign-in link, for the address that asked. `minutes` is how long the link works. */
export function SignInEmail({ url, minutes }: { url: string; minutes: number }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>Your link to sign in to Dalliance. It works for {String(minutes)} minutes.</Preview>
      <Body style={{ backgroundColor: paper, margin: 0, padding: '32px 16px', fontFamily: sans }}>
        <Container style={{ maxWidth: 480, margin: '0 auto' }}>
          <Text style={{ fontFamily: serif, fontSize: 18, fontWeight: 600, letterSpacing: '-0.02em', color: ink, margin: '0 0 20px' }}>Dalliance</Text>
          <Section style={{ backgroundColor: card, border: `1px solid ${hairline}`, borderRadius: 12, padding: '28px 28px 24px' }}>
            <Text style={{ fontFamily: serif, fontSize: 24, lineHeight: '30px', color: ink, margin: '0 0 12px' }}>Sign in to Dalliance</Text>
            <Text style={{ fontSize: 15, lineHeight: '24px', color: soft, margin: '0 0 24px' }}>
              Click the button to sign in. The link works once, for {minutes} minutes.
            </Text>
            <Button
              href={url}
              style={{ backgroundColor: brand, color: onBrand, fontSize: 15, fontWeight: 500, borderRadius: 8, padding: '11px 20px', textDecoration: 'none' }}
            >
              Sign in
            </Button>
            <Hr style={{ borderColor: hairline, margin: '28px 0 16px' }} />
            <Text style={{ fontSize: 13, lineHeight: '20px', color: subtle, margin: '0 0 6px' }}>Or paste this link into your browser:</Text>
            <Link href={url} style={{ fontSize: 13, lineHeight: '20px', color: subtle, wordBreak: 'break-all' }}>
              {url}
            </Link>
          </Section>
          <Text style={{ fontSize: 13, lineHeight: '20px', color: subtle, margin: '20px 4px 0' }}>
            If you didn't ask to sign in, you can ignore this email. Nobody can sign in without the link.
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

/** The plain text part, for clients that don't show HTML. */
export const signInText = ({ url, minutes }: { url: string; minutes: number }) =>
  `Sign in to Dalliance\n\nOpen this link to sign in. It works once, for ${minutes} minutes:\n\n${url}\n\nIf you didn't ask to sign in, you can ignore this email. Nobody can sign in without the link.\n`

// Sample props for `react-email dev`, so the template can be looked at on its own
SignInEmail.PreviewProps = { url: 'https://cloud.dalliance.io/api/auth/magic-link/verify?token=example', minutes: 5 }

export default SignInEmail
