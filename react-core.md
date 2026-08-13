# Tổng quan Kiến trúc React: Fiber, State, và External Store

Biểu đồ dưới đây mô phỏng luồng hoạt động từ lúc State (cả nội bộ và ngoại vi) thay đổi, cách React quản lý V-DOM, Fiber Tree, cho đến các Pattern tối ưu trên Next.js.

## 1. Biểu đồ luồng hoạt động (Architecture Flow)

```mermaid
graph TD
    %% Định nghĩa các Style
    classDef core fill:#61dafb,stroke:#333,stroke-width:2px,color:#000
    classDef state fill:#f9d0c4,stroke:#333,stroke-width:2px,color:#000
    classDef external fill:#ffdfba,stroke:#333,stroke-width:2px,color:#000
    classDef diffing fill:#f4f1de,stroke:#333,stroke-width:2px,color:#000
    classDef nextjs fill:#000,stroke:#fff,stroke-width:2px,color:#fff
    classDef alert fill:#ff9999,stroke:#333,color:#000
    classDef safe fill:#c2f0c2,stroke:#333,color:#000

    %% Phân vùng 1: Quản lý State Nội bộ & Kích hoạt Render
    subgraph subReRender ["Kích hoạt Re-render (Local State)"]
        S1["Local State (Lưu ở Fiber Node)"]
        S2["Gọi hàm Setter (setState)"]
        S3{"Thuật toán Object.is()"}
        S4["Bailing out (Bỏ ngang)"]
        S5["Kích hoạt Re-render"]

        S1 --> S2
        S2 -->|"Automatic Batching (gộp nhiều lần gọi)"| S3
        S3 -->|"Tham chiếu trùng (True)"| S4
        S3 -->|"Tham chiếu khác (False)"| S5
    end

    %% Phân vùng MỚI: Quản lý State Ngoại vi (Zustand, Redux, React Query)
    subgraph subExternal ["State Ngoại vi (External Store)"]
        E1["External Store (Lưu ở RAM, ngoài React)"]:::external
        E2["Thực hiện đổi dữ liệu trong Store"]:::external
        E3["Observer: Báo cho Component đã Subscribe"]:::external
        E4{"useSyncExternalStore (Hook lõi)"}:::external
        E5["Bỏ qua (Do Selector lọc / Snapshot giống)"]:::safe

        E2 --> E1 --> E3 --> E4
        E4 -->|"Khác Snapshot (Cần update)"| S5
        E4 -->|"Giống Snapshot (Không update)"| E5
    end

    %% Phân vùng MỚI 2: Cách các Thư viện triển khai cơ chế External Store
    subgraph subLibs ["Cách các Thư viện triển khai External Store"]
        subgraph subClientLib ["Client State (Đồng bộ)"]
            RTK["Redux Toolkit<br/>dispatch(action) → Reducer (Immer) → State mới (Immutable)"]:::external
            ZU["Zustand<br/>Gọi set() → Merge state trực tiếp (không cần Immer)"]:::external
            JO["Jotai<br/>useSetAtom → Cập nhật đúng Atom (state chia nhỏ theo từng atom, không cần Selector)"]:::external
        end

        subgraph subServerLib ["Server State (Bất đồng bộ / Cache)"]
            RQ["React Query<br/>queryKey + queryFn → Cache theo key, tự động Stale-While-Revalidate"]:::external
            SWR["SWR<br/>key + fetcher → Cache tương tự React Query, API tối giản hơn"]:::external
        end
    end

    RTK -->|"Immutable update"| E2
    ZU -->|"Mutable-style update"| E2
    RQ -->|"Fetch xong / invalidateQueries()"| E2
    SWR -->|"Fetch xong / mutate()"| E2
    JO -->|"Chỉ Component subscribe đúng Atom mới nhận tín hiệu (fine-grained, bỏ qua bước Selector so sánh cả Store)"| E4

    %% Phân vùng 2: Giai đoạn Render & Fiber
    subgraph subRenderPhase ["Giai đoạn Render (Render Phase)"]
        R1["Gọi hàm Component (Từ điểm thay đổi trở xuống)"]
        R2["Tạo React Elements (V-DOM thô)"]
        R3{"Reconciliation (Thuật toán Diffing)"}
        F1[("Current Fiber Tree (Đang hiển thị)")]
        F2[("Work-in-progress Fiber Tree (Bản nháp)")]

        S5 --> R1
        R1 -->|"Tạo ra (Tồn tại chớp nhoáng)"| R2
        R2 -->|"Input dữ liệu"| R3
        F1 -.->|"Đối chiếu"| R3
        R3 -->|"Cập nhật & Đánh dấu (Effect Tags)"| F2
    end

    %% Phân vùng 3: Quy tắc Diffing & DOM
    subgraph subDiffingCommit ["Quy tắc Diffing & Giai đoạn Commit"]
        D1["Khác Loại Thẻ (Khác Tag)"]
        D2["Cùng Loại Thẻ (Cùng Tag)"]
        D3["Danh sách (Lists)"]
        C1["Gỡ bỏ toàn bộ Cây cũ (Mất State)"]:::alert
        C2["Giữ nguyên DOM/Instance, Update Props"]:::safe
        C3["Commit Phase (Đồng bộ lên Browser DOM)"]

        R3 --> D1 & D2 & D3
        D1 --> C1 --> C3
        D2 --> C2 --> C3
        D3 -->|"Key khớp (Match)"| C2
        D3 -->|"Key đổi/thiếu (Mismatch)"| C1
    end

    C3 -.->|"Double Buffering: đổi con trỏ alternate, WIP Tree trở thành Current Tree mới"| F1

    %% Phân vùng 4: Ứng dụng vào Next.js & Pattern
    subgraph subComposition ["Composition Pattern (Next.js / Vue)"]
        N1["Server Component (RSC Payload)"]
        N2["Client Wrapper Component"]
        N3["Truyền qua prop 'children' hoặc slots"]
        N4["Đổi Tag (ví dụ: div -> section)"]
        N5["Đổi data-* attributes / class"]

        N1 --> N3 --> N2
        N2 --> N4 --> C1
        N2 --> N5 --> C2
    end

    %% Áp dụng Style
    class S1,S2,S3,S4,S5 state;
    class R1,R2,R3,F1,F2,C3 core;
    class D1,D2,D3,C1,C2 diffing;
    class N1,N2,N3,N4,N5 nextjs;
```

**Vì sao có 2 Fiber Tree (`F1`/`F2`)?** React dùng kỹ thuật **Double Buffering** (giống cơ chế double-buffer khi render game): `F1` là cây đang hiển thị trên màn hình, `F2` là bản nháp được build song song trong Render Phase để đối chiếu diff mà không đụng vào cây đang hiển thị. Sau khi `C3` (Commit Phase) đồng bộ xong lên DOM thật, React chỉ đổi con trỏ `alternate` — `F2` trở thành `F1` mới cho chu kỳ render tiếp theo, không phải copy lại dữ liệu nên gần như tức thời.

## 2. Cơ chế hoạt động của các Thư viện State Ngoại vi

**Client State (đồng bộ, chạy trên RAM, không có khái niệm "cũ/mới với server"):**

- **Redux Toolkit**: `dispatch(action)` → `reducer` (dùng Immer nội bộ) tính ra state mới theo kiểu **immutable** → store phát tín hiệu cho mọi component đang subscribe qua `useSyncExternalStore`.
- **Zustand**: gọi `set()` để merge thẳng vào store, không cần action/reducer — tối giản hơn Redux nhưng vẫn dùng chung cơ chế `useSyncExternalStore` + selector để tránh render thừa.
- **Jotai**: chia state thành nhiều **atom** độc lập thay vì một store lớn. Khi `useSetAtom` một atom, chỉ những component đang đọc đúng atom đó (và các atom phụ thuộc nó) mới nhận tín hiệu re-render — không cần tự viết Selector như Redux/Zustand.

**Server State (bất đồng bộ, có cache & tự đồng bộ với server):**

- **React Query**: xác định cache bằng `queryKey`, gọi `queryFn` để fetch, áp dụng chiến lược **Stale-While-Revalidate** (trả cache cũ ngay lập tức, âm thầm fetch lại nếu đã stale). Mutation xong gọi `invalidateQueries()` để đánh dấu cache cũ và kích hoạt refetch.
- **SWR**: cùng triết lý stale-while-revalidate và cũng dùng `useSyncExternalStore` nội bộ, nhưng API tối giản hơn — chỉ cần `key` + `fetcher`, và gọi `mutate()` để cập nhật/làm mới cache thủ công.

Điểm chung: dù là client state hay server state, tất cả đều hội tụ về đúng một cơ chế lõi của React — thay đổi dữ liệu trong store, rồi để `useSyncExternalStore` so sánh snapshot và quyết định có kích hoạt re-render hay không (xem nhánh `subExternal` trong biểu đồ).
