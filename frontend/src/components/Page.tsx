import { useState, type ChangeEvent } from 'react';
import { useLightning } from '../lightning/LightningStore';
import './Page.css';
import { Env } from "../Env"

const Page = () => {
  const lightningStore = useLightning();
  const [invoice] = useState('');
  const [me, setMe] = useState({id: "", name: "", macaroon: "", url: ""});
  const [name, setName] = useState('');


  // const [endpoint, setEndpoint] = useState<LightningStore>(REST_ENDPOINT);
  // const [macaroon, setMacaroon] = useState('')

  const handleWhoAmI = async (event: ChangeEvent<HTMLSelectElement>) => {
    const id: any = event.target.value;
    let Me: any;
    switch (id) {
      case "1":
        Me = {
          id: id,
          name: Env.NODE_1_NAME,
          macaroon: Env.NODE_1_ADMIN_MACAROON,
          url: Env.NODE_1_URL,
        }
        break;
      case "2":
        Me = {
          id: "id",
          name: Env.NODE_2_NAME,
          macaroon: Env.NODE_2_ADMIN_MACAROON,
          url: Env.NODE_2_URL,
        }
        break;
      case "3":
        Me = {
          id: "id",
          name: Env.NODE_3_NAME,
          macaroon: Env.NODE_3_ADMIN_MACAROON,
          url: Env.NODE_3_URL,
        }
        break;
      default:
        Me = {
          id: id,
          name: Env.NODE_1_NAME,
          macaroon: Env.NODE_1_ADMIN_MACAROON,
          url: Env.NODE_1_URL,
        }
        break;
    }
    setMe(Me)
    setName(Me.name)

    console.log("Me", Me)
    await lightningStore.whoAmI(event.target.value);
  };

  return (
    <div className="page">
      <p className="page-title">Steps</p>
      <div className="step">
        <p>Who are you?</p>
        <select
          id="nodeId"
          defaultValue=""
          onChange={handleWhoAmI}
        >
          <option value="" disabled>Select a node</option>
          <option value={"1"}>Alice</option>
          <option value={"2"}>Bob</option>
          <option value={"3"}>Carol</option>
        </select>
        <p>You are now {name.toUpperCase()}</p>
        <p>Connection Information:</p>
        <p>ID: {me.id}</p>
        <p>Name: {me.name}</p>
        <p>Macaroon: {me.macaroon.slice(0, 80)}</p>
        <p>URL: {me.url}</p>
      </div>

      <div className="step">
        <p>List peers</p>
        <button
          onClick={() => lightningStore.listPeers()}
        >
          List
        </button>
      </div>

      <div className="step">
        <p>2. Open a channel to Bob</p>
        <button
          onClick={() => lightningStore.openChannel('pubkey', 10000)}
        >
          Open channel
        </button>
      </div>

      <div className="step">
        <p>3. Mine a block 6 times to confirm the channel</p>
        <button>Mine Block</button>
      </div>

      <div className="step">
        <p>4. Mine request an invoice from Bob.</p>
        <button>Request Invoice</button>
        <label>
          <input
            name="invoice"
            disabled
            type="text"
            value={invoice || 'lnbc124324112341...'}
          />
        </label>
      </div>

      <div className="step">
        <p>5. Pay the requested invoice.</p>
        <button>Pay Invoice</button>
        <input
          disabled
          type="text"
          value={invoice || 'lnbc124324112341...'}
        />
      </div>
    </div>
  );
};
export default Page;
