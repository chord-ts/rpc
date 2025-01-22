import { invalidate } from '$app/navigation';
import { redirect, } from '@sveltejs/kit';


export function load({cookies, depends}) {
  depends('user')
  return {username: cookies.get('username')}
}


export const actions = {
	signin: async ({request, cookies}) => {
    const form = await request.formData()
    const username = form.get('username')?.toString()!
    cookies.set('username', username, {path: '/'})
	}
}
