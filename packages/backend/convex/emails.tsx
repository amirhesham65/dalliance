'use node'

import { Resend } from '@convex-dev/resend'
import { render } from '@react-email/render'
import { v } from 'convex/values'
import { SignInEmail, signInText } from '../emails/SignInEmail'
import { components } from './_generated/api'
import { internalAction } from './_generated/server'

/** Sent from dalliance.io, which Resend must have verified. See docs/accounts.md */
const FROM = 'Dalliance <sign-in@dalliance.io>'

// Reads RESEND_API_KEY from the deployment. testMode is off so mail reaches real addresses
const resend = new Resend(components.resend, { testMode: false })

/**
 * Emails a sign-in link. React Email needs Node, so this runs as a Node action that `sendMagicLink` in auth.ts
 * schedules. Without RESEND_API_KEY, as on a development deployment, the link goes to the deployment's logs instead.
 */
export const sendSignInLink = internalAction({
  args: { email: v.string(), url: v.string(), minutes: v.number() },
  handler: async (ctx, { email, url, minutes }) => {
    if (!process.env.RESEND_API_KEY?.trim()) {
      console.warn(`RESEND_API_KEY isn't set, so no email went out. The sign-in link for ${email}: ${url}`)
      return
    }
    await resend.sendEmail(ctx, {
      from: FROM,
      to: email,
      subject: 'Your Dalliance sign-in link',
      html: await render(<SignInEmail url={url} minutes={minutes} />),
      text: signInText({ url, minutes }),
    })
  },
})
