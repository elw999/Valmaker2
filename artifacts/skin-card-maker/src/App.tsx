import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import Designer from "@/pages/designer";
import Guide from "@/pages/guide";
import Privacy from "@/pages/privacy";
import Terms from "@/pages/terms";
import Admin from "@/pages/admin";
import Shop from "@/pages/shop";
import ProductDetail from "@/pages/product-detail";
import Sell from "@/pages/sell";
import MyTransactions from "@/pages/my-transactions";
import Chat from "@/pages/chat";
import Profile from "@/pages/profile";
import LoginModal from "@/components/LoginModal";
import { getEmail } from "@/lib/auth";

const queryClient = new QueryClient();

const PAGE_SUBTITLES: Record<string, string> = {
  "/shop":            "進入交易市場前請先登入帳號",
  "/product":         "查看商品詳情前請先登入帳號",
  "/sell":            "上架商品前請先登入帳號",
  "/my-listings":     "管理上架商品前請先登入帳號",
  "/my-transactions": "查看交易記錄前請先登入帳號",
  "/chat":            "進入聊天室前請先登入帳號",
  "/editor":          "使用製圖工具前請先登入帳號",
  "/guide":           "查看使用教學前請先登入帳號",
  "/profile":         "查看個人資料前請先登入帳號",
};

function RequireAuth({ children, path }: { children: React.ReactNode; path: string }) {
  const email = getEmail();
  const subtitle = Object.entries(PAGE_SUBTITLES).find(([k]) => path.startsWith(k))?.[1];
  if (!email) return <LoginModal subtitle={subtitle} />;
  return <>{children}</>;
}

const AuthShop          = () => <RequireAuth path="/shop"><Shop /></RequireAuth>;
const AuthProductDetail = () => <RequireAuth path="/product"><ProductDetail /></RequireAuth>;
const AuthSell          = () => <RequireAuth path="/sell"><Sell /></RequireAuth>;
const AuthMyListings    = () => <RequireAuth path="/my-listings"><Sell /></RequireAuth>;
const AuthMyTransactions = () => <RequireAuth path="/my-transactions"><MyTransactions /></RequireAuth>;
const AuthChat          = () => <RequireAuth path="/chat"><Chat /></RequireAuth>;
const AuthDesigner      = () => <RequireAuth path="/editor"><Designer /></RequireAuth>;
const AuthGuide         = () => <RequireAuth path="/guide"><Guide /></RequireAuth>;
const AuthProfile       = () => <RequireAuth path="/profile"><Profile /></RequireAuth>;

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/shop" component={AuthShop} />
      <Route path="/product/:id" component={AuthProductDetail} />
      <Route path="/sell" component={AuthSell} />
      <Route path="/my-listings" component={AuthMyListings} />
      <Route path="/my-transactions" component={AuthMyTransactions} />
      <Route path="/chat/:txnId" component={AuthChat} />
      <Route path="/editor" component={AuthDesigner} />
      <Route path="/guide" component={AuthGuide} />
      <Route path="/privacy" component={Privacy} />
      <Route path="/terms" component={Terms} />
      <Route path="/admin" component={Admin} />
      <Route path="/profile" component={AuthProfile} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
