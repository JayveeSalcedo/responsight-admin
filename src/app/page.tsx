import { redirect } from 'next/navigation'

export default function Home() {
  // Default landing route for admins.
  redirect('/dashboard')
}
