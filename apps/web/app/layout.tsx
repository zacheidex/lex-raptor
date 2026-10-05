import './style.css';
export const metadata={title:'Lex Raptor · Open legal research',icons:{icon:'/lex-raptor-logo.png'},description:'Open-source legal research with local AI, inspectable sources, and private matter workspaces.'};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
