import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { currentUserQuery } from "@/hooks/queries";
import { filePath, request } from "@/lib/api";
import type { CurrentUser } from "@/lib/types";
import { ErrorBlock } from "./ErrorBlock";
import { LoadingBlock } from "./LoadingBlock";

export function OwnProfile() {
  const user = useQuery(currentUserQuery());

  if (user.isLoading) return <LoadingBlock label="Loading profile…" />;

  if (user.error) return <ErrorBlock message={user.error.message} />;

  return user.data ? <ProfileForm key={user.data.id} user={user.data} /> : null;
}

function ProfileForm({ user }: { user: CurrentUser }) {
  const client = useQueryClient();
  const [username, setUsername] = useState(user.username);
  const [firstName, setFirstName] = useState(user.first_name ?? "");
  const [lastName, setLastName] = useState(user.last_name ?? "");
  const [password, setPassword] = useState("");

  const [pictureName, setPictureName] = useState(user.picture_file_name ?? null);

  const [photo, setPhoto] = useState<File | null>(null);

  const [uploaded, setUploaded] = useState<{ file: File; name: string } | null>(null);

  const photoInput = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: async () => {
      let picture = pictureName;

      if (photo) {
        picture = uploaded?.file === photo ? uploaded.name : `${crypto.randomUUID()}-${photo.name}`;

        if (uploaded?.file !== photo) {
          await request(filePath("userpictures", picture), {
            method: "PUT",
            body: photo,
          });
          setUploaded({ file: photo, name: picture });
          setPictureName(picture);
        }
      }

      await request(`/api/users/${user.id}`, {
        method: "PUT",
        body: JSON.stringify({
          username,
          first_name: firstName,
          last_name: lastName,
          password,
          picture_file_name: picture,
        }),
      });
    },
    onSuccess: async () => {
      setPassword("");
      setPhoto(null);

      if (photoInput.current) photoInput.current.value = "";
      await Promise.all([
        client.invalidateQueries({ queryKey: ["user", "current"] }),
        client.invalidateQueries({ queryKey: ["users"] }),
      ]);
    },
  });

  return (
    <form
      className="panel panel-inner"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
      onChange={() => {
        if (!save.isPending) save.reset();
      }}
    >
      <div className="form-grid">
        <div className="field">
          <label htmlFor="profile-username">Username</label>
          <input
            disabled={save.isPending}
            id="profile-username"
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="profile-first">First name</label>
          <input
            disabled={save.isPending}
            id="profile-first"
            autoComplete="given-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="profile-last">Last name</label>
          <input
            disabled={save.isPending}
            id="profile-last"
            autoComplete="family-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="profile-password">New password</label>
          <input
            disabled={save.isPending}
            id="profile-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby="profile-password-help"
          />
          <p id="profile-password-help" className="muted">
            Leave blank to keep your password.
          </p>
        </div>
        <div className="field">
          <label htmlFor="profile-photo">Profile photo</label>
          <input
            ref={photoInput}
            disabled={save.isPending}
            id="profile-photo"
            type="file"
            accept="image/*"
            onChange={(event) => setPhoto(event.target.files?.[0] ?? null)}
          />
          {pictureName || photo ? (
            <button
              className="btn btn-ghost"
              type="button"
              disabled={save.isPending}
              onClick={() => {
                setPictureName(null);
                setPhoto(null);
                setUploaded(null);

                if (photoInput.current) photoInput.current.value = "";
                save.reset();
              }}
            >
              Remove photo
            </button>
          ) : null}
        </div>
      </div>
      {save.error ? <ErrorBlock message={save.error.message} /> : null}
      <button className="btn btn-primary" disabled={save.isPending}>
        Save profile
      </button>
      {save.isSuccess ? <p role="status">Profile saved.</p> : null}
    </form>
  );
}
