import base from '/home/user/Objects/frontend/vite.config.ts'
export default { ...base, root: '/home/user/Objects/frontend', test: { ...base.test, include: ['src/**/*.audit.ts', 'src/**/*.audit.tsx'] } }
